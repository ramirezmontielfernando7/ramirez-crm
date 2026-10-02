import { and, isNotNull, sql } from "drizzle-orm";
import { getDb, schema, withTenant } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import {
  chunk,
  chunkRange,
  isAnalyticsNotEnabled,
  parsePricingAnalytics,
  parseTemplateAnalytics,
  PRICING_CHUNK_DAYS,
  pricingAnalyticsFields,
  syncWindow,
  TEMPLATE_CHUNK_DAYS,
  TEMPLATE_IDS_PER_CALL,
  templateAnalyticsFields,
  type AnalyticsKind,
  type PricingDay,
  type TemplateDay,
} from "@/lib/meta-analytics";
import { getOrgCredentials } from "@/server/credentials";
import { markReconnectRequired } from "@/server/whatsapp/credentials";

const log = logger("meta-analiticas");

/**
 * Campañas v2 (PR 3) — Copia diaria de las analíticas de Meta a la base
 * propia: `template_analytics` (90 días) y `pricing_analytics` (1 año) de la
 * WABA. La Pestaña Métricas lee SOLO de aquí; nunca consulta a Meta en vivo.
 *
 * Corre dentro del trabajo diario (`daily.ts`), a nombre de la organización
 * (`runWithOrganization`). Cada llamada a Meta va FUERA de transacción; cada
 * escritura, dentro de `withTenant`. Upsert por llave primaria: dos
 * contenedores a la vez o una re-sincronización no duplican nada.
 *
 * Las dos analíticas son independientes: si Meta responde que las de
 * plantillas no están activas en la WABA, se anota `not_enabled` (la
 * pantalla lo dice) y los precios se sincronizan igual.
 */

export type AnalyticsSyncOutcome = {
  kind: AnalyticsKind;
  status: "ok" | "not_enabled" | "error" | "skipped";
  rows: number;
  message?: string;
};

export async function syncMetaAnalytics(organizationId: string, now: Date = new Date()): Promise<AnalyticsSyncOutcome[]> {
  const creds = await getOrgCredentials(organizationId, "whatsapp", { requireUsable: true });
  if (!creds.ok) {
    return (["template", "pricing"] as const).map((kind) => ({ kind, status: "skipped" as const, rows: 0, message: creds.error }));
  }
  const { wabaId, token } = creds.value;
  const state = await readSyncState(organizationId, wabaId);
  const out: AnalyticsSyncOutcome[] = [];
  for (const kind of ["pricing", "template"] as const) {
    const window = syncWindow(kind, state.get(kind) ?? null, now);
    try {
      const rows =
        kind === "template"
          ? await syncTemplates(organizationId, wabaId, token, window)
          : await syncPricing(organizationId, wabaId, token, window);
      await writeSyncState(organizationId, wabaId, kind, "ok", null);
      out.push({ kind, status: "ok", rows });
    } catch (err) {
      if (err instanceof MetaApiError && err.isAuthError) {
        await markReconnectRequired(organizationId);
        await writeSyncState(organizationId, wabaId, kind, "error", "El token expiró: reconecta el número");
        out.push({ kind, status: "error", rows: 0, message: "reconnect_required" });
        break; // sin token no tiene caso intentar la otra
      }
      const message = err instanceof Error ? err.message.slice(0, 300) : "Error desconocido";
      const status = kind === "template" && err instanceof MetaApiError && isAnalyticsNotEnabled(err.message) ? "not_enabled" : "error";
      await writeSyncState(organizationId, wabaId, kind, status, message);
      log.warn("analíticas de Meta sin sincronizar", { org: organizationId, kind, status, motivo: message });
      out.push({ kind, status, rows: 0, message });
    }
  }
  return out;
}

async function readSyncState(organizationId: string, wabaId: string): Promise<Map<AnalyticsKind, Date | null>> {
  const rows = await getDb()
    .select({ kind: schema.waAnalyticsSync.kind, syncedAt: schema.waAnalyticsSync.syncedAt, wabaId: schema.waAnalyticsSync.wabaId })
    .from(schema.waAnalyticsSync)
    .where(scoped(schema.waAnalyticsSync.organizationId, organizationId));
  return new Map(rows.filter((r) => r.wabaId === wabaId).map((r) => [r.kind, r.syncedAt]));
}

async function writeSyncState(
  organizationId: string,
  wabaId: string,
  kind: AnalyticsKind,
  status: "ok" | "not_enabled" | "error",
  error: string | null
): Promise<void> {
  const t = schema.waAnalyticsSync;
  const now = new Date();
  await withTenant(organizationId, (tx) =>
    tx
      .insert(t)
      .values({ organizationId, wabaId, kind, status, error, attemptedAt: now, syncedAt: status === "ok" ? now : null })
      .onConflictDoUpdate({
        target: [t.organizationId, t.wabaId, t.kind],
        set: {
          status,
          error,
          attemptedAt: now,
          // Un fallo no borra la última sincronización buena: la siguiente
          // retoma desde ahí y no repite la carga inicial.
          syncedAt: status === "ok" ? now : sql`${t.syncedAt}`,
        },
      })
  );
}

async function waTemplateIds(organizationId: string): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ id: schema.template.waTemplateId })
    .from(schema.template)
    .where(and(scoped(schema.template.organizationId, organizationId), isNotNull(schema.template.waTemplateId)));
  return rows.map((r) => r.id).filter((id): id is string => !!id);
}

async function syncTemplates(
  organizationId: string,
  wabaId: string,
  token: string,
  window: { start: number; end: number }
): Promise<number> {
  const ids = await waTemplateIds(organizationId);
  let total = 0;
  for (const range of chunkRange(window.start, window.end, TEMPLATE_CHUNK_DAYS)) {
    for (const group of chunk(ids, TEMPLATE_IDS_PER_CALL)) {
      const fields = encodeURIComponent(templateAnalyticsFields(range.start, range.end, group));
      const json = await graphRequest<unknown>(`${wabaId}?fields=${fields}`, { token });
      const rows = parseTemplateAnalytics(json);
      await upsertTemplateDays(organizationId, wabaId, rows);
      total += rows.length;
    }
  }
  return total;
}

async function syncPricing(
  organizationId: string,
  wabaId: string,
  token: string,
  window: { start: number; end: number }
): Promise<number> {
  let total = 0;
  for (const range of chunkRange(window.start, window.end, PRICING_CHUNK_DAYS)) {
    const fields = encodeURIComponent(pricingAnalyticsFields(range.start, range.end));
    const json = await graphRequest<unknown>(`${wabaId}?fields=${fields}`, { token });
    const { currency, rows } = parsePricingAnalytics(json);
    await upsertPricingDays(organizationId, wabaId, currency, rows);
    total += rows.length;
  }
  return total;
}

const BATCH = 500;

async function upsertTemplateDays(organizationId: string, wabaId: string, rows: TemplateDay[]): Promise<void> {
  if (rows.length === 0) return;
  const t = schema.waTemplateAnalyticsDaily;
  const now = new Date();
  await withTenant(organizationId, async (tx) => {
    for (const part of chunk(rows, BATCH)) {
      await tx
        .insert(t)
        .values(part.map((r) => ({ organizationId, wabaId, ...r, syncedAt: now })))
        .onConflictDoUpdate({
          target: [t.organizationId, t.wabaId, t.waTemplateId, t.day],
          set: {
            sent: sql`excluded.sent`,
            delivered: sql`excluded.delivered`,
            read: sql`excluded.read`,
            clicked: sql`excluded.clicked`,
            clicks: sql`excluded.clicks`,
            syncedAt: sql`excluded.synced_at`,
          },
        });
    }
  });
}

async function upsertPricingDays(
  organizationId: string,
  wabaId: string,
  currency: string | null,
  rows: PricingDay[]
): Promise<void> {
  if (rows.length === 0) return;
  const t = schema.waPricingAnalyticsDaily;
  const now = new Date();
  await withTenant(organizationId, async (tx) => {
    for (const part of chunk(rows, BATCH)) {
      await tx
        .insert(t)
        .values(part.map((r) => ({ organizationId, wabaId, ...r, currency, syncedAt: now })))
        .onConflictDoUpdate({
          target: [t.organizationId, t.wabaId, t.day, t.phoneNumberId, t.country, t.pricingCategory, t.pricingType],
          set: {
            volume: sql`excluded.volume`,
            cost: sql`excluded.cost`,
            currency: sql`coalesce(excluded.currency, ${t.currency})`,
            syncedAt: sql`excluded.synced_at`,
          },
        });
    }
  });
}
