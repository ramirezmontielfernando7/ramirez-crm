import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import {
  getCredentialsByOrg,
  type Credentials,
} from "@/server/whatsapp/credentials";
import { deviceMediaKeyId } from "@/lib/direct-inbound";
import { logger } from "@/lib/log";
import { downloadDeviceMedia } from "@/server/direct-connection/inbound-media";
import { checkOutgoing, kindFromMime, WA_MEDIA_RULES } from "@/lib/upload-limits";

const log = logger("media");

/**
 * 008 — Única frontera de media con la Graph API (constitución II: todo el
 * tráfico a Meta pasa por adaptadores dedicados) + persistencia en el volumen
 * local `MEDIA_DIR`. Meta expira sus archivos (~30 días, URLs de minutos):
 * el disco propio es la copia durable que la UI previsualiza.
 */

export type MediaKind = (typeof schema.mediaAsset.$inferSelect)["kind"];

/** Límites de la Cloud API por tipo (validados ANTES de tocar red, FR-007). */
export const MEDIA_LIMITS: Record<
  Exclude<MediaKind, "location" | "contacts">,
  { maxBytes: number; mimes: RegExp; label: string }
> = {
  image: { ...WA_MEDIA_RULES.image, label: "imagen (jpeg/png/webp, máx. 5 MB)" },
  sticker: { ...WA_MEDIA_RULES.sticker, label: "sticker (webp, máx. 100 KB)" },
  audio: { ...WA_MEDIA_RULES.audio, label: "audio (aac/mp4/mpeg/amr/ogg, máx. 16 MB)" },
  video: { ...WA_MEDIA_RULES.video, label: "video (mp4/3gpp, máx. 16 MB)" },
  document: { ...WA_MEDIA_RULES.document, label: "documento (máx. 100 MB)" },
};

/** Clasifica un MIME de archivo saliente al tipo de mensaje de la Cloud API. */
export { kindFromMime };

export class MediaValidationError extends Error {
  code: "too_large" | "unsupported_type";
  constructor(code: MediaValidationError["code"], message: string) {
    super(message);
    this.name = "MediaValidationError";
    this.code = code;
  }
}

/**
 * Valida MIME y tamaño para envío; devuelve el kind resuelto. Las reglas (y
 * el mensaje para la persona) viven en `src/lib/upload-limits.ts`, las mismas
 * que revisa el navegador antes de subir. 044: SVG y HTML no se mandan.
 */
export function validateOutgoing(mime: string, sizeBytes: number, fileName?: string) {
  const check = checkOutgoing(mime, sizeBytes, fileName);
  if (!check.ok) throw new MediaValidationError(check.code, check.message);
  return check.kind;
}

/* ---------- Disco local ---------- */

function assertSafeSegment(s: string): void {
  if (!/^[\w.-]+$/.test(s)) throw new Error(`segmento de ruta inválido: ${s}`);
}

/** Ruta absoluta del archivo de un asset dentro de MEDIA_DIR. */
export function mediaFilePath(organizationId: string, assetId: string): string {
  assertSafeSegment(organizationId);
  assertSafeSegment(assetId);
  return path.join(getEnv().MEDIA_DIR, organizationId, assetId);
}

export async function saveMediaFile(
  organizationId: string,
  assetId: string,
  data: Buffer | Uint8Array
): Promise<string> {
  const file = mediaFilePath(organizationId, assetId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  return path.join(organizationId, assetId); // ruta relativa persistida en BD
}

export async function readMediaFile(
  organizationId: string,
  assetId: string
): Promise<Buffer> {
  return readFile(mediaFilePath(organizationId, assetId));
}

/**
 * 018 — Borra el archivo de un asset. Sin error si ya no estaba: quien lo
 * llama está deshaciendo una copia que sobró, y un archivo que no existe es
 * justo el estado al que quiere llegar.
 */
export async function deleteMediaFile(
  organizationId: string,
  assetId: string
): Promise<void> {
  await rm(mediaFilePath(organizationId, assetId), { force: true });
}

/* ---------- Descarga desde Graph (entrantes y echoes) ---------- */

type GraphMediaMeta = { url?: string; mime_type?: string; file_size?: number };

export class MediaFetchError extends Error {
  /** true si Meta ya no tiene el archivo (expirado/borrado) — no reintentar. */
  gone: boolean;
  constructor(message: string, gone = false) {
    super(message);
    this.name = "MediaFetchError";
    this.gone = gone;
  }
}

/**
 * Descarga un media de Graph: GET {mediaId} → url efímera → GET con Bearer.
 * El token JAMÁS sale del servidor.
 */
export async function downloadGraphMedia(
  token: string,
  waMediaId: string,
  maxBytes: number = MEDIA_LIMITS.document.maxBytes
): Promise<{ data: Buffer; mimeType: string | null; fileSize: number }> {
  let meta: GraphMediaMeta;
  try {
    meta = await graphRequest<GraphMediaMeta>(waMediaId, { token });
  } catch (err) {
    const gone = err instanceof MetaApiError && err.status === 404;
    throw new MediaFetchError("Meta no entregó la metadata del adjunto", gone);
  }
  if (!meta.url) throw new MediaFetchError("Meta no entregó URL del adjunto");
  if (meta.file_size && meta.file_size > maxBytes) {
    throw new MediaFetchError("El adjunto excede el límite de tamaño", true);
  }

  let res: Response;
  try {
    res = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new MediaFetchError("No se pudo descargar el adjunto");
  }
  if (!res.ok) {
    throw new MediaFetchError(
      `La descarga devolvió ${res.status}`,
      res.status === 404 || res.status === 410
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new MediaFetchError("El adjunto excede el límite de tamaño", true);
  }
  return {
    data: buf,
    mimeType: meta.mime_type ?? res.headers.get("content-type"),
    fileSize: buf.byteLength,
  };
}

/**
 * Garantiza que el asset esté en disco (`fetchStatus=available`).
 * Se usa en la descarga in-process post-ingesta Y on-demand desde la ruta de
 * media. Nunca lanza hacia el webhook: el que llama decide qué hacer con el
 * resultado. Devuelve el asset actualizado o null si no se pudo.
 */
export async function ensureAssetAvailable(
  organizationId: string,
  assetId: string
): Promise<typeof schema.mediaAsset.$inferSelect | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.mediaAsset)
    .where(eq(schema.mediaAsset.id, assetId))
    .limit(1);
  const asset = rows[0];
  if (!asset || asset.organizationId !== organizationId) return null;
  if (asset.fetchStatus === "available") return asset;
  if (!asset.waMediaId) return null; // location/contacts no tienen binario

  // Conexión directa (PR 6): lo que entró por el dispositivo se descarga de
  // él, no de Meta (la empresa puede no tener Meta).
  const deviceKeyId = deviceMediaKeyId(asset.waMediaId);
  const waMediaId = asset.waMediaId;
  let download: () => Promise<{ data: Buffer; mimeType: string | null; fileSize: number }>;
  if (deviceKeyId) {
    download = () => downloadDeviceMedia(organizationId, deviceKeyId, MEDIA_LIMITS.document.maxBytes);
  } else {
    const creds = await getCredentialsByOrg(organizationId);
    if (!creds) return null;
    download = () => downloadGraphMedia(creds.token, waMediaId);
  }

  try {
    const { data, mimeType, fileSize } = await download();
    const storagePath = await saveMediaFile(organizationId, assetId, data);
    const updated = await db
      .update(schema.mediaAsset)
      .set({
        storagePath,
        mimeType: asset.mimeType ?? mimeType,
        fileSize,
        fetchStatus: "available",
        fetchError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.mediaAsset.id, assetId))
      .returning();
    return updated[0] ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.mediaAsset)
      .set({ fetchStatus: "failed", fetchError: message, updatedAt: new Date() })
      .where(eq(schema.mediaAsset.id, assetId));
    log.warn("descarga del adjunto falló", { org: organizationId, adjunto: assetId, err: message });
    return null;
  }
}

/* ---------- Subida a Graph (salientes) ---------- */

/**
 * Sube un archivo a Graph (`POST /{phone_number_id}/media`, multipart) y
 * devuelve el media id para usar en /messages. Errores → MetaApiError (la
 * capa de envío los traduce con las mismas reglas que el texto).
 */
export async function uploadGraphMedia(
  credentials: Credentials,
  file: { data: Buffer | Uint8Array; mimeType: string; fileName?: string }
): Promise<string> {
  const env = getEnv();
  const url = `${env.META_GRAPH_BASE_URL}/${env.META_GRAPH_API_VERSION}/${credentials.phoneNumberId}/media`;
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", file.mimeType);
  const bytes = new Uint8Array(file.data);
  form.set(
    "file",
    new Blob([bytes], { type: file.mimeType }),
    file.fileName ?? "adjunto"
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.token}` },
      body: form,
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Meta", {
      status: 0,
      details: cause,
    });
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number; type?: string } })
      ?.error;
    throw new MetaApiError(err?.message ?? `Meta respondió ${res.status}`, {
      status: res.status,
      code: err?.code ?? null,
      type: err?.type ?? null,
      details: json ?? text,
    });
  }
  const id = (json as { id?: string })?.id;
  if (!id) {
    throw new MetaApiError("Meta no devolvió ID del media subido", {
      status: res.status,
    });
  }
  return id;
}
