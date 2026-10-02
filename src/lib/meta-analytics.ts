/**
 * Campañas v2 (PR 3) — Reglas puras de las analíticas de Meta
 * (`template_analytics` y `pricing_analytics` de la WABA): cómo se piden,
 * cómo se leen y qué ventana toca sincronizar. Sin E/S: las prueba
 * `tests/unit/meta-analytics.test.ts`.
 *
 * Los nombres de campos y la sintaxis NO están verificados contra la
 * documentación oficial (ver docs/campanas-v2-meta.md, PR 3): la lectura es
 * tolerante (lo que no llegue queda en 0 o '') y una respuesta inesperada
 * no tumba la sincronización.
 */

/** Cuánto guarda Meta (y cuánto trae la primera carga). */
export const TEMPLATE_RETENTION_DAYS = 90;
export const PRICING_RETENTION_DAYS = 365;
/** La diaria vuelve a pedir estos días: Meta corrige los días recientes. */
export const RESYNC_OVERLAP_DAYS = 3;
/** Tramos por llamada (respuestas chicas, sin depender de la paginación). */
export const TEMPLATE_CHUNK_DAYS = 30;
export const PRICING_CHUNK_DAYS = 90;
/** Meta acepta pocas plantillas por llamada de `template_analytics`. */
export const TEMPLATE_IDS_PER_CALL = 10;

const DAY = 86_400;

export type AnalyticsKind = "template" | "pricing";

/** `YYYY-MM-DD` (UTC) de un instante Unix en segundos. */
export function unixToDay(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** Medianoche UTC (segundos) de un `YYYY-MM-DD`. */
export function dayToUnix(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
}

/**
 * Ventana [start, end) en segundos Unix que toca pedir. Primera vez (nunca
 * sincronizada): toda la retención de Meta. Después: desde unos días antes
 * de la última sincronización (Meta corrige los días recientes), sin pasar
 * de la retención. `end` = mañana a medianoche UTC (incluye hoy).
 */
export function syncWindow(
  kind: AnalyticsKind,
  lastSyncedAt: Date | null,
  now: Date = new Date()
): { start: number; end: number } {
  const today = dayToUnix(now.toISOString().slice(0, 10));
  const end = today + DAY;
  const retention = kind === "template" ? TEMPLATE_RETENTION_DAYS : PRICING_RETENTION_DAYS;
  // Un día menos que la retención: Meta rechaza un inicio fuera de ella.
  const oldest = today - (retention - 1) * DAY;
  if (!lastSyncedAt) return { start: oldest, end };
  const last = dayToUnix(lastSyncedAt.toISOString().slice(0, 10));
  return { start: Math.max(oldest, last - RESYNC_OVERLAP_DAYS * DAY), end };
}

/** Parte [start, end) en tramos de `days` días. */
export function chunkRange(start: number, end: number, days: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let s = start; s < end; s += days * DAY) out.push({ start: s, end: Math.min(end, s + days * DAY) });
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** `fields=` de la WABA para las analíticas de plantillas. */
export function templateAnalyticsFields(start: number, end: number, templateIds: string[]): string {
  // Solo ids con forma de id (Meta los da numéricos): nada que rompa la sintaxis.
  const ids = templateIds.filter((id) => /^[\w-]+$/.test(id));
  return (
    `template_analytics.start(${start}).end(${end}).granularity(DAILY)` +
    `.metric_types(["SENT","DELIVERED","READ","CLICKED"])` +
    `.template_ids(${JSON.stringify(ids)})`
  );
}

/** `fields=` de la WABA para las analíticas de precios (y su moneda). */
export function pricingAnalyticsFields(start: number, end: number): string {
  return (
    `currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY)` +
    `.dimensions(["PRICING_CATEGORY","PRICING_TYPE","COUNTRY","PHONE"])`
  );
}

const int = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};
const money = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n * 10_000) / 10_000 : 0;
};
const txt = (v: unknown, max = 64): string =>
  typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "";

type DataBlock = { data_points?: unknown[] } | undefined;
const dataPoints = (node: unknown): Record<string, unknown>[] => {
  const blocks = (node as { data?: DataBlock[] } | undefined)?.data;
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap((b) => (Array.isArray(b?.data_points) ? b.data_points : [])).filter(
    (p): p is Record<string, unknown> => typeof p === "object" && p !== null
  );
};

export type TemplateDay = {
  waTemplateId: string;
  day: string;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  clicks: { type?: string; button_content?: string; count?: number }[];
};

/** Respuesta de `template_analytics` → filas por (plantilla, día). */
export function parseTemplateAnalytics(json: unknown): TemplateDay[] {
  const byKey = new Map<string, TemplateDay>();
  for (const p of dataPoints((json as { template_analytics?: unknown } | null)?.template_analytics)) {
    const id = txt(p.template_id);
    const start = int(p.start);
    if (!id || !start) continue;
    const clicks = (Array.isArray(p.clicked) ? p.clicked : [])
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map((c) => ({ type: txt(c.type), button_content: txt(c.button_content, 200), count: int(c.count) }));
    const row: TemplateDay = {
      waTemplateId: id,
      day: unixToDay(start),
      sent: int(p.sent),
      delivered: int(p.delivered),
      read: int(p.read),
      clicked: clicks.reduce((s, c) => s + c.count, 0),
      clicks,
    };
    // Una misma llave repetida (dos bloques): se queda la última, como el upsert.
    byKey.set(`${row.waTemplateId}|${row.day}`, row);
  }
  return [...byKey.values()];
}

export type PricingDay = {
  day: string;
  phoneNumberId: string;
  country: string;
  pricingCategory: string;
  pricingType: string;
  volume: number;
  cost: number;
};

/** Respuesta de `pricing_analytics` → filas por (día, número, país, categoría, tipo), sumadas. */
export function parsePricingAnalytics(json: unknown): { currency: string | null; rows: PricingDay[] } {
  const root = json as { currency?: unknown; pricing_analytics?: unknown } | null;
  const byKey = new Map<string, PricingDay>();
  for (const p of dataPoints(root?.pricing_analytics)) {
    const start = int(p.start);
    if (!start) continue;
    const row: PricingDay = {
      day: unixToDay(start),
      phoneNumberId: txt(p.phone_number_id ?? p.phone_number),
      country: txt(p.country, 8).toUpperCase(),
      pricingCategory: txt(p.pricing_category).toUpperCase(),
      pricingType: txt(p.pricing_type).toUpperCase(),
      volume: int(p.volume),
      cost: money(p.cost),
    };
    const key = [row.day, row.phoneNumberId, row.country, row.pricingCategory, row.pricingType].join("|");
    const prev = byKey.get(key);
    if (prev) {
      prev.volume += row.volume;
      prev.cost = Math.round((prev.cost + row.cost) * 10_000) / 10_000;
    } else byKey.set(key, row);
  }
  const currency = txt(root?.currency, 3).toUpperCase() || null;
  return { currency, rows: [...byKey.values()] };
}

/**
 * ¿Meta dice que las analíticas de plantillas no están activas en la WABA?
 * (Se activan desde el Administrador de WhatsApp o con
 * `is_enabled_for_insights`.) El texto exacto NO está verificado: se busca
 * por palabras clave para no confundirlo con un fallo cualquiera.
 */
export function isAnalyticsNotEnabled(message: string | null | undefined): boolean {
  if (!message) return false;
  return /is_enabled_for_insights|insights.*(not|no).*enabled|not enabled|no est[aá]n? (activ|habilit)|enable.*(template )?analytics|analytics.*(disabled|not available)/i.test(
    message
  );
}
