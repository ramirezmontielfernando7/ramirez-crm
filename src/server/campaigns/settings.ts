import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { CampaignSettingsDto } from "@/lib/campaigns";

/**
 * Campañas v2 (PR 2) — Ajustes de envío por organización (`campaign_settings`).
 * Sin fila = estos valores por defecto. Las tarifas vienen VACÍAS: Vocero no
 * trae precios de Meta; el negocio captura los suyos y el costo se muestra
 * como "Estimado".
 */
export const DEFAULT_CAMPAIGN_SETTINGS: CampaignSettingsDto = {
  failRatePercent: 20,
  failRateWindow: 50,
  pauseOnQualityRed: true,
  usagePausePercent: 95,
  rates: {},
  currency: null,
  replyWindowHours: 72,
};

export const RATE_CATEGORIES = ["marketing", "utility", "authentication"] as const;

export async function getCampaignSettings(organizationId: string): Promise<CampaignSettingsDto> {
  const rows = await getDb()
    .select()
    .from(schema.campaignSettings)
    .where(scoped(schema.campaignSettings.organizationId, organizationId))
    .limit(1);
  const r = rows[0];
  if (!r) return { ...DEFAULT_CAMPAIGN_SETTINGS, rates: {} };
  return {
    failRatePercent: r.failRatePercent,
    failRateWindow: r.failRateWindow,
    pauseOnQualityRed: r.pauseOnQualityRed,
    usagePausePercent: r.usagePausePercent,
    rates: cleanRates(r.rates),
    currency: r.currency,
    replyWindowHours: r.replyWindowHours,
  };
}

/** Solo las categorías conocidas, con números finitos ≥ 0. */
export function cleanRates(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const c of RATE_CATEGORIES) {
    const v = (raw as Record<string, unknown>)[c];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[c] = v;
  }
  return out;
}

export async function saveCampaignSettings(
  organizationId: string,
  userId: string,
  input: CampaignSettingsDto
): Promise<CampaignSettingsDto> {
  const values = {
    failRatePercent: input.failRatePercent,
    failRateWindow: input.failRateWindow,
    pauseOnQualityRed: input.pauseOnQualityRed,
    usagePausePercent: input.usagePausePercent,
    rates: cleanRates(input.rates),
    currency: input.currency?.trim().toUpperCase().slice(0, 3) || null,
    replyWindowHours: input.replyWindowHours,
    updatedBy: userId,
    updatedAt: new Date(),
  };
  await getDb()
    .insert(schema.campaignSettings)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({ target: schema.campaignSettings.organizationId, set: values });
  return getCampaignSettings(organizationId);
}

/**
 * Costo ESTIMADO: destinatarios × tarifa de la categoría de la plantilla.
 * null si la organización no capturó esa tarifa (no se inventa un precio).
 */
export function estimateCost(
  settings: Pick<CampaignSettingsDto, "rates" | "currency">,
  category: string | null | undefined,
  recipients: number
): { amount: number; currency: string | null } | null {
  const key = (category ?? "").toLowerCase();
  const rate = settings.rates[key];
  if (rate === undefined) return null;
  return { amount: Math.round(rate * recipients * 10_000) / 10_000, currency: settings.currency };
}

/** Para pruebas y el guion de E2E: borra la fila (vuelve a los valores por defecto). */
export async function resetCampaignSettings(organizationId: string): Promise<void> {
  await getDb()
    .delete(schema.campaignSettings)
    .where(scoped(schema.campaignSettings.organizationId, organizationId));
}
