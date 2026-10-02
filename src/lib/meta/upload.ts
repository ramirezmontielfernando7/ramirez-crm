import { getEnv } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";

/**
 * Campañas v2 (PR 1) — API de subida reanudable de la app de Meta, para la
 * imagen de EJEMPLO de una plantilla con encabezado de imagen (Meta pide un
 * `header_handle` al crearla). Dos pasos:
 *
 *   1. POST /{app-id}/uploads?file_length=…&file_type=…  → { id: "upload:…" }
 *   2. POST /{upload-id} con el archivo (cabecera file_offset: 0) → { h }
 *
 * NO VERIFICADO contra la documentación oficial (el proxy de este entorno
 * bloquea developers.facebook.com): ver docs/campanas-v2-meta.md. Requiere
 * META_APP_ID; sin ella, `isHeaderImageAvailable()` es false y la interfaz
 * deshabilita la opción.
 */

export function isHeaderImageAvailable(): boolean {
  return Boolean(getEnv().META_APP_ID);
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON: se conserva el texto crudo en details
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number; type?: string } } | null)?.error;
    throw new MetaApiError(err?.message ?? `Meta respondió ${res.status}`, {
      status: res.status,
      code: err?.code ?? null,
      type: err?.type ?? null,
      details: json ?? text,
    });
  }
  return json;
}

async function post(url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", ...init });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Meta", { status: 0, details: cause });
  }
  return parse(res);
}

/** Sube la imagen y devuelve el `header_handle` para el ejemplo de la plantilla. */
export async function uploadTemplateHeaderSample(
  token: string,
  file: { data: Uint8Array; mimeType: string }
): Promise<string> {
  const env = getEnv();
  if (!env.META_APP_ID) {
    throw new MetaApiError("Falta META_APP_ID para subir la imagen de la plantilla", { status: 400 });
  }
  const base = `${env.META_GRAPH_BASE_URL}/${env.META_GRAPH_API_VERSION}`;
  const qs = new URLSearchParams({ file_length: String(file.data.byteLength), file_type: file.mimeType });
  const session = (await post(`${base}/${env.META_APP_ID}/uploads?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  })) as { id?: string } | null;
  const sessionId = session?.id;
  if (!sessionId || !/^upload:[\w.:=-]+$/.test(sessionId)) {
    throw new MetaApiError("Meta no devolvió la sesión de subida", { status: 502, details: session });
  }
  const uploaded = (await post(`${base}/${sessionId}`, {
    headers: { Authorization: `OAuth ${token}`, file_offset: "0", "Content-Type": file.mimeType },
    body: new Uint8Array(file.data),
  })) as { h?: string } | null;
  if (!uploaded?.h) {
    throw new MetaApiError("Meta no devolvió el identificador de la imagen", { status: 502, details: uploaded });
  }
  return uploaded.h;
}
