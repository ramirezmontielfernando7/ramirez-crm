import { and, eq, inArray, or } from "drizzle-orm";
import {
  bodyFromComponents,
  buildTemplateComponents,
  countVariables,
  renderBody,
  sendRequirements,
  validateBodyVariables,
  validateTemplateDraft,
  type TemplateComponentDto,
  type TemplateDraft,
} from "@/lib/templates";
import { runWithOrganization } from "@/lib/request-context";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { logger } from "@/lib/log";
import { graphRequest, MetaApiError, normalizeRecipient } from "@/lib/meta/client";
import { destinatarioMeta } from "@/lib/meta/destinatario";
import { isHeaderImageAvailable, uploadTemplateHeaderSample } from "@/lib/meta/upload";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import {
  getCredentialsByOrg,
  markReconnectRequired,
} from "@/server/whatsapp/credentials";
import { resolveWaba } from "@/server/credentials/resolve";
import { assertOrgActive } from "@/server/platform-admin/org-status";
import { recordUnrouted, unroutedReasonFor } from "@/server/webhooks/unrouted";
import { callGraphSend, SendError } from "@/server/inbox/send";
import { serializeMessage } from "@/server/inbox/ingest";
import type { WebhookValue } from "@/server/inbox/webhook";
import {
  deleteMediaFile,
  MEDIA_LIMITS,
  readMediaFile,
  saveMediaFile,
  uploadGraphMedia,
} from "@/server/whatsapp/media";

const log = logger("plantillas");

/** Errores tipados del servicio de plantillas → HTTP en la capa de API. */
export class TemplateError extends Error {
  code:
    | "not_connected"
    | "reconnect_required"
    | "invalid"
    | "not_found"
    | "meta_error"
    | "meta_unavailable";

  constructor(code: TemplateError["code"], message: string) {
    super(message);
    this.name = "TemplateError";
    this.code = code;
  }
}

const TEMPLATE_ERROR_STATUS: Record<TemplateError["code"], number> = {
  not_connected: 409,
  reconnect_required: 409,
  invalid: 422,
  not_found: 404,
  meta_error: 422,
  meta_unavailable: 503,
};

export function templateErrorStatus(err: TemplateError): number {
  return TEMPLATE_ERROR_STATUS[err.code];
}

export { countVariables, renderBody, validateBodyVariables };

type TemplateRow = typeof schema.template.$inferSelect;

/**
 * ¿Se puede ENVIAR? Aprobada localmente Y (Campañas v2) sin pausa ni
 * desactivación de Meta, y con todo lo que el envío necesita.
 */
export function templateSendability(t: TemplateRow): { sendable: boolean; reason: string | null } {
  if (t.status !== "approved") return { sendable: false, reason: "No está aprobada por Meta" };
  const meta = t.metaStatus?.toUpperCase();
  if (meta && meta !== "APPROVED") {
    return {
      sendable: false,
      reason:
        meta === "PAUSED"
          ? `Meta la pausó por calidad${t.pausedReason ? ` (${t.pausedReason})` : ""}`
          : meta === "DISABLED"
            ? "Meta la desactivó"
            : `Meta la reporta como ${meta}`,
    };
  }
  const req = sendRequirements(t.components);
  if (req.unsupported) return { sendable: false, reason: req.unsupported };
  if (req.headerImage && !t.headerMediaAssetId) {
    return {
      sendable: false,
      reason: "Lleva imagen en el encabezado y el CRM no tiene la imagen (créala desde el CRM para poder enviarla)",
    };
  }
  return { sendable: true, reason: null };
}

export function serializeTemplate(t: TemplateRow) {
  const { sendable, reason } = templateSendability(t);
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    status: t.status,
    rejectionReason: t.rejectionReason,
    components: (t.components ?? null) as TemplateComponentDto[] | null,
    metaStatus: t.metaStatus,
    pausedReason: t.pausedReason,
    qualityScore: t.qualityScore,
    /** Meta cambió la categoría y nadie lo ha marcado como visto. */
    categoryChange:
      t.categoryChangedAt && t.previousCategory && !t.categoryChangeSeenAt
        ? { from: t.previousCategory, to: t.category, at: t.categoryChangedAt.toISOString() }
        : null,
    hasHeaderImage: Boolean(t.headerMediaAssetId),
    sendable,
    unsendableReason: reason,
    syncedAt: t.syncedAt?.toISOString() ?? null,
  };
}

function metaFailure(err: MetaApiError, organizationId: string): Promise<never> {
  return (async () => {
    if (err.isAuthError) {
      await markReconnectRequired(organizationId);
      throw new TemplateError("reconnect_required", "El token expiró: reconecta el número");
    }
    if (err.status === 0 || err.status >= 500) {
      throw new TemplateError("meta_unavailable", "Meta no está disponible ahora");
    }
    throw new TemplateError("meta_error", err.message);
  })();
}

/** Imagen del encabezado que llega del navegador (ya leída). */
export type HeaderImageInput = { data: Uint8Array; mimeType: string; fileName: string };

/**
 * Crea la plantilla y la manda a aprobación de Meta (FR-050; Campañas v2:
 * encabezado de texto o imagen, pie, botones de respuesta rápida o URL y los
 * ejemplos que escribe el usuario).
 *
 * Con imagen: se guarda en el disco propio ANTES de llamar a Meta (si Meta
 * rechaza, se borra) porque al enviar la plantilla Meta pide la imagen en
 * cada mensaje y no hay otra copia.
 */
export async function createTemplate(
  organizationId: string,
  draft: TemplateDraft,
  headerImage?: HeaderImageInput | null
): Promise<TemplateRow> {
  const draftError = validateTemplateDraft(draft);
  if (draftError) throw new TemplateError("invalid", draftError);
  if (draft.header.format === "IMAGE") {
    if (!isHeaderImageAvailable()) {
      throw new TemplateError(
        "invalid",
        "Para usar imagen en el encabezado falta configurar META_APP_ID en el servidor"
      );
    }
    if (!headerImage) throw new TemplateError("invalid", "Sube la imagen del encabezado");
    if (!/^image\/(jpeg|png)$/.test(headerImage.mimeType)) {
      throw new TemplateError("invalid", "La imagen del encabezado debe ser JPG o PNG");
    }
    if (headerImage.data.byteLength > MEDIA_LIMITS.image.maxBytes) {
      throw new TemplateError("invalid", `La imagen excede el límite de ${MEDIA_LIMITS.image.label}`);
    }
  }

  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    throw new TemplateError("not_connected", "Conecta tu número de WhatsApp primero");
  }
  if (creds.status === "reconnect_required") {
    throw new TemplateError("reconnect_required", "Reconecta tu número antes de crear plantillas");
  }

  const name = draft.name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (!name) throw new TemplateError("invalid", "Nombre de plantilla inválido");

  const db = getDb();
  let assetId: string | null = null;
  let headerHandle: string | null = null;
  if (draft.header.format === "IMAGE" && headerImage) {
    assetId = newId("mediaAsset");
    const storagePath = await saveMediaFile(organizationId, assetId, headerImage.data);
    await db.insert(schema.mediaAsset).values({
      id: assetId,
      organizationId,
      kind: "image",
      mimeType: headerImage.mimeType,
      fileName: headerImage.fileName.slice(0, 200),
      fileSize: headerImage.data.byteLength,
      storagePath,
      fetchStatus: "available",
    });
  }

  const discardImage = async () => {
    if (!assetId) return;
    await db.delete(schema.mediaAsset).where(scoped(schema.mediaAsset.organizationId, organizationId, eq(schema.mediaAsset.id, assetId)));
    await deleteMediaFile(organizationId, assetId);
  };

  let waTemplateId: string | null = null;
  let components: TemplateComponentDto[];
  try {
    if (assetId && headerImage) {
      headerHandle = await uploadTemplateHeaderSample(creds.token, headerImage);
    }
    components = buildTemplateComponents(draft, headerHandle);
    const res = await graphRequest<{ id?: string; status?: string; category?: string }>(
      `${creds.wabaId}/message_templates`,
      {
        method: "POST",
        token: creds.token,
        body: { name, language: draft.language, category: draft.category, components },
      }
    );
    waTemplateId = res.id ?? null;
  } catch (err) {
    await discardImage();
    if (err instanceof MetaApiError) return metaFailure(err, organizationId);
    throw err;
  }

  // Lo que se guarda no lleva el handle de ejemplo (dura poco y no sirve para enviar).
  const stored = buildTemplateComponents(draft, null);
  const inserted = await db
    .insert(schema.template)
    .values({
      id: newId("template"),
      organizationId,
      name,
      language: draft.language,
      category: draft.category,
      body: draft.body,
      status: "pending",
      metaStatus: "PENDING",
      components: stored,
      headerMediaAssetId: assetId,
      waTemplateId,
    })
    .onConflictDoUpdate({
      target: [
        schema.template.organizationId,
        schema.template.name,
        schema.template.language,
      ],
      set: {
        category: draft.category,
        body: draft.body,
        status: "pending",
        metaStatus: "PENDING",
        rejectionReason: null,
        pausedReason: null,
        components: stored,
        headerMediaAssetId: assetId,
        waTemplateId,
        updatedAt: new Date(),
      },
    })
    .returning();
  return inserted[0]!;
}

/**
 * Estado de Meta → los cuatro estados locales. PAUSED sigue `approved`
 * localmente (Meta puede reactivarla), pero `meta_status` la bloquea al
 * enviar; DISABLED es definitiva. Lo que no se reconoce no cambia el estado
 * local (y queda en `meta_status`).
 */
export function mapMetaStatus(
  status: string | undefined | null
): TemplateRow["status"] | null {
  const s = (status ?? "").toUpperCase();
  if (s === "APPROVED" || s === "PAUSED") return "approved";
  if (s === "REJECTED" || s === "DISABLED") return "rejected";
  if (s === "PENDING" || s === "IN_APPEAL" || s === "PENDING_DELETION") {
    return "pending";
  }
  return null;
}

type RemoteTemplate = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: TemplateComponentDto[];
  quality_score?: { score?: string } | string;
  rejected_reason?: string;
};

type TemplatePage = {
  data?: RemoteTemplate[];
  paging?: { cursors?: { after?: string }; next?: string };
};

const TEMPLATE_FIELDS = "id,name,language,status,category,components,quality_score,rejected_reason";
/** Tope de páginas por sincronización (protección contra un bucle de paginación). */
const MAX_TEMPLATE_PAGES = 50;

/** Todas las plantillas de la WABA, página por página (`paging.cursors.after`). */
async function fetchAllTemplates(wabaId: string, token: string): Promise<RemoteTemplate[]> {
  const out: RemoteTemplate[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_TEMPLATE_PAGES; page++) {
    const qs = new URLSearchParams({ fields: TEMPLATE_FIELDS, limit: "100" });
    if (after) qs.set("after", after);
    const res: TemplatePage = await graphRequest<TemplatePage>(`${wabaId}/message_templates?${qs}`, { token });
    out.push(...(res.data ?? []));
    const next: string | null = res.paging?.next ? (res.paging.cursors?.after ?? null) : null;
    if (!next || next === after) return out;
    after = next;
  }
  log.warn("la WABA tiene más plantillas que el tope de páginas: se importaron las primeras", { paginas: MAX_TEMPLATE_PAGES });
  return out;
}

/**
 * Igualdad de componentes sin depender del orden de las llaves: Postgres
 * reordena las llaves de un `jsonb`, así que lo leído de la BD y lo que
 * manda Meta nunca coinciden como texto aunque sean lo mismo.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((k) => [k, norm((v as Record<string, unknown>)[k])])
          )
        : v;
  return JSON.stringify(norm(a ?? null)) === JSON.stringify(norm(b ?? null));
}

function qualityOf(q: RemoteTemplate["quality_score"]): string | null {
  const v = typeof q === "string" ? q : q?.score;
  return v ? v.toUpperCase().slice(0, 32) : null;
}

/**
 * Sincroniza desde Graph (`GET {waba}/message_templates`, paginado): estado,
 * categoría, componentes y calidad de las que ya existen, e IMPORTA las que
 * existen en la WABA y no en el CRM (Campañas v2). Cubre el modo agencia:
 * los webhooks de plantillas NO siguen el override de callback, así que el
 * pull es la vía universal (DV-VC-04/DV-VC-15). Devuelve cuántas cambiaron
 * o se importaron.
 */
export async function syncTemplates(organizationId: string): Promise<number> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    throw new TemplateError("not_connected", "Conecta tu número de WhatsApp primero");
  }

  let remote: RemoteTemplate[];
  try {
    remote = await fetchAllTemplates(creds.wabaId, creds.token);
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(organizationId);
        throw new TemplateError("reconnect_required", "El token expiró: reconecta el número");
      }
      throw new TemplateError("meta_unavailable", "No se pudo consultar Meta");
    }
    throw err;
  }

  const db = getDb();
  const local = await db
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId));

  let changed = 0;
  const now = new Date();
  for (const r of remote) {
    if (!r.name || !r.language) continue;
    const status = mapMetaStatus(r.status);
    const metaStatus = r.status ? r.status.toUpperCase().slice(0, 32) : null;
    const components = Array.isArray(r.components) ? r.components : null;
    const match = local.find(
      (t) => (r.id && t.waTemplateId === r.id) || (t.name === r.name && t.language === r.language)
    );
    if (!match) {
      // Campañas v2: la plantilla existe en la WABA pero no en el CRM.
      await db
        .insert(schema.template)
        .values({
          id: newId("template"),
          organizationId,
          name: r.name,
          language: r.language,
          category: r.category ?? "UTILITY",
          body: bodyFromComponents(components),
          status: status ?? "pending",
          metaStatus,
          rejectionReason: r.rejected_reason && r.rejected_reason !== "NONE" ? r.rejected_reason : null,
          components,
          qualityScore: qualityOf(r.quality_score),
          waTemplateId: r.id ?? null,
          syncedAt: now,
        })
        .onConflictDoNothing();
      changed++;
      continue;
    }
    // Meta reclasifica la categoría (una UTILITY puede volverse MARKETING,
    // lo que cambia el costo): es autoridad, y el cambio se avisa en la UI.
    const category = r.category ?? match.category;
    const categoryChanged = category !== match.category;
    const nextStatus = status ?? match.status;
    const body = components ? bodyFromComponents(components) || match.body : match.body;
    const same =
      match.status === nextStatus &&
      !categoryChanged &&
      match.metaStatus === metaStatus &&
      match.qualityScore === qualityOf(r.quality_score) &&
      sameJson(match.components, components ?? match.components);
    await db
      .update(schema.template)
      .set({
        status: nextStatus,
        category,
        metaStatus,
        body,
        components: components ?? match.components,
        qualityScore: qualityOf(r.quality_score),
        rejectionReason:
          nextStatus === "rejected" ? (r.rejected_reason && r.rejected_reason !== "NONE" ? r.rejected_reason : match.rejectionReason) : null,
        waTemplateId: match.waTemplateId ?? r.id ?? null,
        ...(categoryChanged
          ? { previousCategory: match.category, categoryChangedAt: now, categoryChangeSeenAt: null }
          : {}),
        syncedAt: now,
        ...(same ? {} : { updatedAt: now }),
      })
      .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.id, match.id)));
    if (!same) changed++;
  }
  return changed;
}

/** El evento llegó a nivel WABA: a qué organización enrutarlo, o null (ya guardado como sin ruta). */
async function routeWabaEvent(wabaId: string | null, field: string, value: unknown): Promise<string | null> {
  if (!wabaId) return null;
  // H8: `waba_id` es único (whatsapp_business_account): una sola organización.
  const creds = await resolveWaba(wabaId);
  if (!creds) {
    await recordUnrouted({ source: "whatsapp", routeKind: "waba_id", routeKey: wabaId, field, payload: value });
    return null;
  }
  if (creds.orgStatus !== "active") {
    await recordUnrouted({ source: "whatsapp", routeKind: "waba_id", routeKey: wabaId, field, payload: value, reason: unroutedReasonFor(creds.orgStatus) });
    return null;
  }
  return creds.organizationId;
}

/** Evento webhook `message_template_status_update` (modo directo, FR-050). */
export async function applyTemplateStatusEvent(
  wabaId: string | null,
  value: WebhookValue
): Promise<void> {
  const organizationId = await routeWabaEvent(wabaId, "message_template_status_update", value);
  if (!organizationId) return;

  const metaStatus = value.event ? value.event.toUpperCase().slice(0, 32) : null;
  const status = mapMetaStatus(metaStatus);
  const name = value.message_template_name;
  const language = value.message_template_language;
  if (!metaStatus || !name || !language) return;
  const reason = typeof value.reason === "string" && value.reason !== "NONE" ? value.reason : null;

  // PR 3: la consulta fija `app.org_id` de la organización del WABA.
  const db = getDb();
  await runWithOrganization(organizationId, () => db
    .update(schema.template)
    .set({
      ...(status ? { status } : {}),
      metaStatus,
      rejectionReason: status === "rejected" ? reason : null,
      pausedReason: metaStatus === "PAUSED" || metaStatus === "DISABLED" ? reason : null,
      syncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      scoped(schema.template.organizationId, organizationId,
        eq(schema.template.name, name),
        eq(schema.template.language, language)
      )
    ));
}

/**
 * Campañas v2 — Webhook `template_category_update`: Meta cambió la categoría
 * de una plantilla (p. ej. UTILITY → MARKETING, que cambia el costo). Se
 * guarda la nueva, la anterior y cuándo, para avisar en la interfaz. Corre
 * ya a nombre de la organización (waba-events.ts la enrutó).
 */
export async function applyTemplateCategoryEvent(
  organizationId: string,
  value: Record<string, unknown>
): Promise<void> {
  const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
  const id = str(value.message_template_id);
  const name = str(value.message_template_name);
  const language = str(value.message_template_language);
  const next = str(value.new_category).toUpperCase().slice(0, 32);
  if (!next || (!id && !name)) return;
  const db = getDb();
  // Por id de Meta, o por nombre (+ idioma) para las que el CRM aún no
  // conoce por id.
  const byName = name
    ? language
      ? and(eq(schema.template.name, name), eq(schema.template.language, language))
      : eq(schema.template.name, name)
    : undefined;
  const where = id && byName ? or(eq(schema.template.waTemplateId, id), byName) : id ? eq(schema.template.waTemplateId, id) : byName;
  const rows = await db
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId, where));
  for (const t of rows) {
    if (t.category === next) continue;
    await db
      .update(schema.template)
      .set({
        previousCategory: str(value.old_category).toUpperCase().slice(0, 32) || t.category,
        category: next,
        categoryChangedAt: new Date(),
        categoryChangeSeenAt: null,
        updatedAt: new Date(),
      })
      .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.id, t.id)));
  }
}

/** El equipo ya vio el aviso de cambio de categoría. */
export async function markCategoryChangeSeen(organizationId: string, templateIds: string[]): Promise<number> {
  if (templateIds.length === 0) return 0;
  const rows = await getDb()
    .update(schema.template)
    .set({ categoryChangeSeenAt: new Date() })
    .where(scoped(schema.template.organizationId, organizationId, inArray(schema.template.id, templateIds)))
    .returning({ id: schema.template.id });
  return rows.length;
}

/** Cuánto se reutiliza el media id de la imagen del encabezado antes de volver a subirla. */
const HEADER_MEDIA_REUSE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * El media id de Graph de la imagen del encabezado: se sube una vez y se
 * reutiliza (una campaña de mil envíos no sube mil veces la misma imagen).
 * Pasado `HEADER_MEDIA_REUSE_MS` (margen propio, conservador) se vuelve a subir.
 */
async function headerMediaId(
  organizationId: string,
  assetId: string,
  creds: NonNullable<Awaited<ReturnType<typeof getCredentialsByOrg>>>
): Promise<string> {
  const db = getDb();
  const [asset] = await db
    .select()
    .from(schema.mediaAsset)
    .where(scoped(schema.mediaAsset.organizationId, organizationId, eq(schema.mediaAsset.id, assetId)))
    .limit(1);
  if (!asset) throw new TemplateError("invalid", "La imagen del encabezado ya no existe");
  if (asset.waMediaId && Date.now() - asset.updatedAt.getTime() < HEADER_MEDIA_REUSE_MS) return asset.waMediaId;
  const data = await readMediaFile(organizationId, assetId);
  const id = await uploadGraphMedia(creds, { data, mimeType: asset.mimeType ?? "image/jpeg", fileName: asset.fileName ?? "encabezado" });
  await db
    .update(schema.mediaAsset)
    .set({ waMediaId: id, updatedAt: new Date() })
    .where(scoped(schema.mediaAsset.organizationId, organizationId, eq(schema.mediaAsset.id, assetId)));
  return id;
}

/** Envía una plantilla APROBADA a una conversación (ventana cerrada, FR-051). */
export async function sendTemplate(input: {
  organizationId: string;
  conversationId: string;
  templateId: string;
  variables?: string[];
}): Promise<{ messageId: string }> {
  // Fase 3, PR 2: nada sale de una organización suspendida o dada de baja.
  await assertOrgActive(input.organizationId);
  const db = getDb();

  const templates = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        input.organizationId,
        eq(schema.template.id, input.templateId)
      )
    )
    .limit(1);
  const template = templates[0];
  if (!template) throw new TemplateError("not_found", "Plantilla no encontrada");
  if (template.status !== "approved") {
    throw new TemplateError("invalid", "Solo se pueden enviar plantillas aprobadas");
  }
  // Campañas v2: pausada o desactivada por Meta, o con algo que el envío no
  // sabe llenar. "aprobadas" en el mensaje: el ejecutor de campañas lo
  // reconoce como "detener la campaña" (afecta a todos).
  const sendability = templateSendability(template);
  if (!sendability.sendable) {
    throw new TemplateError("invalid", `La plantilla no se puede enviar: ${sendability.reason}. Solo se envían plantillas aprobadas y activas`);
  }
  // Meta exige EXACTAMENTE un parámetro por variable del cuerpo: si sobran o
  // falta alguno responde 132000 (plantilla y parámetros no coinciden).
  const variableCount = countVariables(template.body);
  const values = (input.variables ?? [])
    .slice(0, variableCount)
    .map((v) => v.trim());
  if (values.length < variableCount || values.some((v) => !v)) {
    const missing = values.findIndex((v) => !v);
    const n = missing === -1 ? values.length + 1 : missing + 1;
    throw new TemplateError(
      "invalid",
      variableCount === 1
        ? "La plantilla requiere el valor de {{1}}"
        : `La plantilla requiere ${variableCount} valores: falta {{${n}}}`
    );
  }

  const rows = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new TemplateError("not_found", "Conversación no encontrada");
  if (row.conversation.isTest) {
    // Aserción dura del sandbox (FR-031)
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  const creds = await getCredentialsByOrg(input.organizationId);
  if (!creds) throw new TemplateError("not_connected", "Sin número conectado");
  if (creds.status === "reconnect_required") {
    throw new TemplateError("reconnect_required", "Reconecta el número");
  }

  // 003: destinatario = teléfono normalizado o BSUID.
  // 003: teléfono en `to`, BSUID en `recipient` — Meta los pide en campos
  // distintos y mandar el BSUID en `to` devuelve 131026.
  const destinatario = destinatarioMeta(
    row.contact.phone ? normalizeRecipient(row.contact.phone) : null,
    row.contact.waUserId
  );
  if (!destinatario) {
    throw new TemplateError(
      "meta_error",
      "El contacto no tiene teléfono ni identidad de WhatsApp utilizable"
    );
  }

  const components: unknown[] = [];
  if (sendRequirements(template.components).headerImage && template.headerMediaAssetId) {
    let mediaId: string;
    try {
      mediaId = await headerMediaId(input.organizationId, template.headerMediaAssetId, creds);
    } catch (err) {
      if (err instanceof MetaApiError) {
        throw new SendError(
          err.isAuthError ? "reconnect_required" : err.status === 0 || err.status >= 500 ? "meta_unavailable" : "meta_error",
          `No se pudo subir la imagen del encabezado: ${err.message}`,
          err.code ?? undefined
        );
      }
      throw err;
    }
    components.push({ type: "header", parameters: [{ type: "image", image: { id: mediaId } }] });
  }
  if (variableCount > 0) {
    components.push({ type: "body", parameters: values.map((text) => ({ type: "text", text })) });
  }

  const waMessageId = await callGraphSend(creds, {
    messaging_product: "whatsapp",
    ...destinatario,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      ...(components.length > 0 ? { components } : {}),
    },
  });

  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId,
      direction: "out",
      type: "template",
      text: renderBody(template.body, values),
      status: "pending",
      origin: "template",
    })
    .returning();
  const message = inserted[0]!;

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, input.conversationId));

  publish(input.organizationId, {
    type: "message.new",
    data: {
      conversationId: input.conversationId,
      message: serializeMessage(message),
    },
  });

  return { messageId: message.id };
}
