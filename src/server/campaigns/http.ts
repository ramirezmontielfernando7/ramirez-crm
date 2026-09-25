import { z } from "zod";
import { apiError } from "@/lib/api";
import { SOURCE_FILTER_VALUES } from "@/server/contact-filter";
import { CAMPAIGN_ERROR_STATUS, CampaignError } from "@/server/campaigns/service";

/** 021 — Piezas HTTP compartidas por las rutas de campañas. */

/** Público elegible. NO hay campo de consentimiento: siempre es opt_in. */
export const audienceSchema = z
  .object({
    tagIds: z.array(z.string().min(1)).max(50).optional(),
    source: z.enum(SOURCE_FILTER_VALUES).optional(),
  })
  .strict();

export const variableSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), value: z.string().max(500) }),
  z.object({ kind: z.literal("contact_name") }),
]);

export function campaignErrorResponse(err: unknown): Response {
  if (err instanceof CampaignError) {
    return apiError(CAMPAIGN_ERROR_STATUS[err.code], err.code, err.message);
  }
  throw err;
}
