import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import {
  computeHealthAlerts,
  parseMessagingLimit,
  utcDay,
  type HealthAlert,
  type PhoneHealthSnapshot,
} from "@/lib/phone-health";
import { getOrgCredentials } from "@/server/credentials";
import { getMessagingSettings } from "@/server/messaging-settings";
import { markReconnectRequired } from "@/server/whatsapp/credentials";

const log = logger("salud-numero");

/**
 * Campañas v2 (PR 1) — Salud del número de WhatsApp.
 *
 * - `refreshPhoneHealth`: lee de Meta calidad, límite, estado y rendimiento
 *   del número y escribe la fila del DÍA (upsert). La llamada a Meta va
 *   FUERA de toda transacción; la escritura, dentro de `withTenant`.
 * - `getHealthSummary`: lo que muestra la app (última lectura, historial,
 *   uso del día y alertas). Nunca consulta a Meta en vivo.
 * - Webhooks `phone_number_quality_update` / `account_update`: actualizan la
 *   fila del día (`recordHealthEvent`).
 *
 * Los nombres de campos de Graph NO están verificados contra la
 * documentación oficial (ver docs/campanas-v2-meta.md): si Meta rechaza un
 * campo, se reintenta con el conjunto mínimo y lo que no llegue queda vacío.
 */

/** Campos pedidos al nodo del número. El primero que falle cae al mínimo. */
const FULL_FIELDS =
  "quality_rating,status,throughput,name_status,messaging_limit_tier,whatsapp_business_manager_messaging_limit";
const MIN_FIELDS = "quality_rating,status,name_status,messaging_limit_tier";

type GraphPhone = {
  quality_rating?: string;
  status?: string;
  name_status?: string;
  throughput?: { level?: string } | string;
  messaging_limit_tier?: string;
  whatsapp_business_manager_messaging_limit?: string | { current_limit?: string };
};

export type HealthReading = {
  qualityRating: string | null;
  messagingLimit: string | null;
  status: string | null;
  throughputLevel: string | null;
  nameStatus: string | null;
};

const str = (v: unknown, max = 64): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** Respuesta de Graph → lectura normalizada. Exportada para las pruebas. */
export function readingFromGraph(p: GraphPhone): HealthReading {
  const bm = p.whatsapp_business_manager_messaging_limit;
  // `messaging_limit_tier` está marcado como obsoleto: se prefiere el del
  // portafolio de negocio cuando viene.
  const limit = str(typeof bm === "object" && bm !== null ? bm.current_limit : bm) ?? str(p.messaging_limit_tier);
  return {
    qualityRating: str(p.quality_rating)?.toUpperCase() ?? null,
    messagingLimit: limit?.toUpperCase() ?? null,
    status: str(p.status)?.toUpperCase() ?? null,
    throughputLevel: str(typeof p.throughput === "object" && p.throughput !== null ? p.throughput.level : p.throughput),
    nameStatus: str(p.name_status),
  };
}

export type RefreshResult =
  | { ok: true; snapshot: PhoneHealthSnapshot }
  | { ok: false; error: "not_connected" | "reconnect_required" | "meta_unavailable" | "meta_error"; message: string };

async function fetchFromMeta(phoneNumberId: string, token: string): Promise<GraphPhone> {
  try {
    return await graphRequest<GraphPhone>(`${phoneNumberId}?fields=${FULL_FIELDS}`, { token });
  } catch (err) {
    // Código 100 = parámetro/campo inválido: la versión de Graph no conoce
    // algún campo nuevo. Se reintenta con el mínimo.
    if (err instanceof MetaApiError && err.code === 100) {
      return graphRequest<GraphPhone>(`${phoneNumberId}?fields=${MIN_FIELDS}`, { token });
    }
    throw err;
  }
}

/** Lee de Meta y guarda la fila del día. Para el trabajo diario y el botón "Actualizar". */
export async function refreshPhoneHealth(
  organizationId: string,
  source: "sync" | "manual" | "webhook"
): Promise<RefreshResult> {
  const creds = await getOrgCredentials(organizationId, "whatsapp", { requireUsable: true });
  if (!creds.ok) {
    return creds.error === "not_connected"
      ? { ok: false, error: "not_connected", message: "Conecta tu número de WhatsApp primero" }
      : { ok: false, error: "reconnect_required", message: "Reconecta tu número de WhatsApp en Ajustes" };
  }
  const { phoneNumberId, token } = creds.value;

  let graph: GraphPhone;
  try {
    graph = await fetchFromMeta(phoneNumberId, token);
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(organizationId);
        return { ok: false, error: "reconnect_required", message: "El token expiró: reconecta el número" };
      }
      if (err.status === 0 || err.status >= 500) {
        return { ok: false, error: "meta_unavailable", message: "Meta no está disponible ahora; intenta más tarde" };
      }
      return { ok: false, error: "meta_error", message: err.message };
    }
    throw err;
  }

  const snapshot = await saveReading(organizationId, phoneNumberId, readingFromGraph(graph), source);
  return { ok: true, snapshot };
}

function toSnapshot(r: typeof schema.waPhoneHealth.$inferSelect): PhoneHealthSnapshot {
  return {
    day: r.day,
    qualityRating: r.qualityRating,
    messagingLimit: r.messagingLimit,
    messagingLimitValue: r.messagingLimitValue,
    status: r.status,
    throughputLevel: r.throughputLevel,
    nameStatus: r.nameStatus,
    accountEvent: r.accountEvent ?? null,
    source: r.source,
    fetchedAt: r.fetchedAt.toISOString(),
  };
}

/**
 * Upsert de la fila del día. Lo que no llega (null) conserva lo que ya
 * había ese día: un webhook que solo trae el límite no borra la calidad.
 */
async function saveReading(
  organizationId: string,
  phoneNumberId: string,
  reading: Partial<HealthReading> & { accountEvent?: Record<string, unknown> | null },
  source: "sync" | "manual" | "webhook"
): Promise<PhoneHealthSnapshot> {
  const t = schema.waPhoneHealth;
  const keep = (col: AnyPgColumn) => sql`coalesce(excluded.${sql.identifier(col.name)}, ${col})`;
  const limit = reading.messagingLimit ?? null;
  const [row] = await withTenant(organizationId, (tx) =>
    tx
      .insert(t)
      .values({
        id: newId("phoneHealth"),
        organizationId,
        phoneNumberId,
        day: utcDay(),
        qualityRating: reading.qualityRating ?? null,
        messagingLimit: limit,
        messagingLimitValue: parseMessagingLimit(limit),
        status: reading.status ?? null,
        throughputLevel: reading.throughputLevel ?? null,
        nameStatus: reading.nameStatus ?? null,
        accountEvent: reading.accountEvent ?? null,
        source,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [t.organizationId, t.phoneNumberId, t.day],
        set: {
          qualityRating: keep(t.qualityRating),
          messagingLimit: keep(t.messagingLimit),
          messagingLimitValue: keep(t.messagingLimitValue),
          status: keep(t.status),
          throughputLevel: keep(t.throughputLevel),
          nameStatus: keep(t.nameStatus),
          accountEvent: keep(t.accountEvent),
          source,
          fetchedAt: new Date(),
        },
      })
      .returning()
  );
  return toSnapshot(row!);
}

/**
 * Webhooks a nivel WABA (`phone_number_quality_update`, `account_update`):
 * se anotan en la fila del día del número de la organización. Quien llama ya
 * enrutó la WABA y abrió el contexto de la organización.
 */
export async function recordHealthEvent(
  organizationId: string,
  field: "phone_number_quality_update" | "account_update",
  value: Record<string, unknown>
): Promise<void> {
  const creds = await getOrgCredentials(organizationId, "whatsapp");
  if (!creds.ok) {
    log.warn("evento de salud sin número conectado: ignorado", { org: organizationId, campo: field });
    return;
  }
  if (field === "account_update") {
    await saveReading(organizationId, creds.value.phoneNumberId, { accountEvent: value }, "webhook");
    return;
  }
  const currentLimit = typeof value.current_limit === "string" ? value.current_limit.toUpperCase() : null;
  await saveReading(organizationId, creds.value.phoneNumberId, { messagingLimit: currentLimit }, "webhook");
}

/**
 * Destinatarios ÚNICOS a los que se les mandó una plantilla en las últimas
 * 24 h (aproximación propia del límite de mensajería: lo cuenta Meta, por
 * portafolio y fuera de la ventana de servicio). Sin el Laboratorio.
 */
export async function usageLast24h(organizationId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await getDb()
    .select({ n: sql<number>`count(distinct ${schema.conversation.contactId})::int` })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      and(
        eq(schema.conversation.organizationId, schema.message.organizationId),
        eq(schema.conversation.id, schema.message.conversationId)
      )
    )
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.direction, "out"),
        eq(schema.message.origin, "template"),
        eq(schema.conversation.isTest, false),
        gte(schema.message.createdAt, since)
      )
    );
  return Number(row?.n ?? 0);
}

export type HealthSummary = {
  connected: boolean;
  phoneNumberId: string | null;
  today: PhoneHealthSnapshot | null;
  previous: PhoneHealthSnapshot | null;
  history: PhoneHealthSnapshot[];
  usage: number;
  usageAlertPercent: number;
  alerts: HealthAlert[];
};

/** Lo que muestran la tarjeta y el aviso. Solo lee la base propia. */
export async function getHealthSummary(organizationId: string): Promise<HealthSummary> {
  const creds = await getOrgCredentials(organizationId, "whatsapp");
  const phoneNumberId = creds.ok ? creds.value.phoneNumberId : null;
  const [rows, usage, settings] = await Promise.all([
    phoneNumberId
      ? getDb()
          .select()
          .from(schema.waPhoneHealth)
          .where(
            scoped(
              schema.waPhoneHealth.organizationId,
              organizationId,
              eq(schema.waPhoneHealth.phoneNumberId, phoneNumberId)
            )
          )
          .orderBy(desc(schema.waPhoneHealth.day))
          .limit(30)
      : Promise.resolve([]),
    usageLast24h(organizationId),
    getMessagingSettings(organizationId),
  ]);
  const history = rows.map(toSnapshot);
  const today = history[0] ?? null;
  const previous = history[1] ?? null;
  return {
    connected: creds.ok,
    phoneNumberId,
    today,
    previous,
    history,
    usage,
    usageAlertPercent: settings.usageAlertPercent,
    alerts: computeHealthAlerts({ today, previous, usage, usageAlertPercent: settings.usageAlertPercent }),
  };
}

/** ¿Se leyó de Meta hace menos de `ms`? (freno del botón "Actualizar", vale entre contenedores). */
export async function readRecently(organizationId: string, ms: number): Promise<boolean> {
  const [row] = await getDb()
    .select({ fetchedAt: schema.waPhoneHealth.fetchedAt })
    .from(schema.waPhoneHealth)
    .where(scoped(schema.waPhoneHealth.organizationId, organizationId))
    .orderBy(desc(schema.waPhoneHealth.fetchedAt))
    .limit(1);
  return !!row && Date.now() - row.fetchedAt.getTime() < ms;
}
