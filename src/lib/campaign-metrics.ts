import { toCsv } from "@/lib/csv";
import type { PeriodDto } from "@/lib/analytics";

/**
 * Campañas v2 (PR 3) — Contratos y reglas puras de la Pestaña Métricas.
 *
 * Definiciones (iguales en la pantalla, el CSV y las pruebas):
 * - Enviados: destinatarios que Meta ACEPTÓ (`campaign_recipient.status = sent`).
 * - Entregados / Leídos: el mensaje tiene hora de entrega / lectura (o el
 *   estado lo dice). Porcentaje sobre enviados.
 * - Respondieron: el contacto escribió en esa conversación dentro de la
 *   ventana (`campaign_settings.reply_window_hours`, 72 h por defecto) tras
 *   el envío. Porcentaje sobre enviados.
 * - Fallidos: Meta lo rechazó al enviar o el mensaje terminó en `failed`.
 * - Bajas: el contacto quedó en `opt_out` después de recibirla.
 * - Costo: por campaña SIEMPRE "Estimado" (tarifas que captura el negocio).
 *   En los totales del periodo se pone junto a lo "Reportado por Meta"
 *   (`pricing_analytics`), con la diferencia.
 */

export type FunnelCounts = {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  optOuts: number;
};

export type FailureReason = { code: number | null; reason: string; count: number };

export type CampaignMetricsRow = FunnelCounts & {
  id: string;
  name: string;
  status: string;
  startedAt: string | null;
  templateName: string | null;
  category: string | null;
  phoneNumberId: string | null;
  /** Estimado (proporcional a lo enviado en el periodo); null = sin tarifa. */
  estimatedCost: number | null;
};

export type MetaSyncInfo = {
  status: "ok" | "not_enabled" | "error" | "never";
  syncedAt: string | null;
  attemptedAt: string | null;
  error: string | null;
};

export type TemplateAnalyticsRow = {
  waTemplateId: string;
  name: string | null;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
};

export type CostReconciliation = {
  /** Suma de lo estimado de las campañas del periodo; null = ninguna con tarifa. */
  estimated: number | null;
  estimatedCurrency: string | null;
  /** Lo que Meta reporta para el periodo (todas las categorías); null = sin datos sincronizados. */
  reported: number | null;
  reportedCurrency: string | null;
  /** reported − estimated; null si falta uno o las monedas no coinciden. */
  difference: number | null;
  /** Por qué no hay diferencia, en español (o null si la hay). */
  differenceNote: string | null;
  byCategory: { category: string; volume: number; cost: number }[];
};

export type CampaignMetricsDto = {
  period: PeriodDto;
  phoneNumberId: string | null;
  phoneOptions: { id: string; label: string }[];
  replyWindowHours: number;
  totals: FunnelCounts;
  failureReasons: FailureReason[];
  series: (FunnelCounts & { bucket: string })[];
  campaigns: CampaignMetricsRow[];
  cost: CostReconciliation;
  templates: TemplateAnalyticsRow[];
  sync: { template: MetaSyncInfo; pricing: MetaSyncInfo };
};

export function emptyFunnel(): FunnelCounts {
  return { sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, optOuts: 0 };
}

/** Porcentaje (un decimal) de `part` sobre `total`; null si no hay base. */
export function pct(part: number, total: number): number | null {
  if (!total || total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

export function formatPct(part: number, total: number): string {
  const p = pct(part, total);
  return p === null ? "—" : `${p.toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Costo estimado de lo enviado en el periodo para una campaña: lo estimado al
 * lanzar (destinatarios × tarifa) prorrateado por lo enviado; si al lanzar no
 * había tarifa, la tarifa de hoy de su categoría. Null = sin tarifa.
 */
export function campaignEstimatedCost(input: {
  launchEstimate: number | null;
  total: number;
  sent: number;
  rate: number | undefined;
}): number | null {
  if (input.launchEstimate !== null && input.total > 0) return round4((input.launchEstimate * input.sent) / input.total);
  if (input.rate !== undefined) return round4(input.rate * input.sent);
  return null;
}

/** Junta estimado y reportado y dice, con honestidad, si se pueden restar. */
export function reconcileCost(input: {
  estimated: number | null;
  estimatedCurrency: string | null;
  reported: number | null;
  reportedCurrency: string | null;
  byCategory: { category: string; volume: number; cost: number }[];
}): CostReconciliation {
  let difference: number | null = null;
  let differenceNote: string | null = null;
  if (input.reported === null) differenceNote = "Meta aún no reporta costos para este periodo";
  else if (input.estimated === null) differenceNote = "Captura tus tarifas en Ajustes de envío para estimar el costo";
  else if (input.estimatedCurrency && input.reportedCurrency && input.estimatedCurrency !== input.reportedCurrency) {
    differenceNote = `Monedas distintas (${input.estimatedCurrency} frente a ${input.reportedCurrency}): no se restan`;
  } else difference = round4(input.reported - input.estimated);
  return { ...input, difference, differenceNote };
}

/** Exportación CSV: una fila por campaña, con totales al final. */
export function metricsCsv(dto: Pick<CampaignMetricsDto, "campaigns" | "totals" | "cost">): string {
  const header = [
    "Campaña",
    "Inicio",
    "Plantilla",
    "Categoría",
    "Enviados",
    "Entregados",
    "Entregados %",
    "Leídos",
    "Leídos %",
    "Respondieron",
    "Respondieron %",
    "Fallidos",
    "Bajas",
    "Costo estimado",
  ];
  const line = (name: string, start: string, tpl: string, cat: string, f: FunnelCounts, cost: number | null) => [
    name,
    start,
    tpl,
    cat,
    f.sent,
    f.delivered,
    pct(f.delivered, f.sent) ?? "",
    f.read,
    pct(f.read, f.sent) ?? "",
    f.replied,
    pct(f.replied, f.sent) ?? "",
    f.failed,
    f.optOuts,
    cost ?? "",
  ];
  const rows = dto.campaigns.map((c) =>
    line(c.name, c.startedAt?.slice(0, 10) ?? "", c.templateName ?? "", c.category ?? "", c, c.estimatedCost)
  );
  rows.push(line("Total del periodo", "", "", "", dto.totals, dto.cost.estimated));
  return toCsv(header, rows);
}

/** Etiqueta en español del estado de sincronización de una analítica. */
export function syncLabel(kind: "template" | "pricing", s: MetaSyncInfo): string {
  const what = kind === "template" ? "Analíticas de plantillas" : "Costos reportados por Meta";
  switch (s.status) {
    case "ok":
      return `${what}: al día`;
    case "not_enabled":
      return `${what}: no están activas en tu cuenta de WhatsApp Business (WABA)`;
    case "error":
      return `${what}: la última sincronización falló`;
    default:
      return `${what}: aún no se sincronizan (se hace una vez al día)`;
  }
}
