import { runWithOrganization } from "@/lib/request-context";
import { logger } from "@/lib/log";
import { resolveWaba } from "@/server/credentials/resolve";
import { recordUnrouted, unroutedReasonFor } from "@/server/webhooks/unrouted";
import { recordHealthEvent } from "@/server/whatsapp/health";
import { applyTemplateCategoryEvent } from "@/server/whatsapp/templates";

const log = logger("webhook-waba");

/**
 * Campañas v2 (PR 1) — Eventos de webhook a nivel WABA (llegan con
 * `entry.id` = WABA, sin número): salud del número, avisos de la cuenta y
 * cambio de categoría de una plantilla. Se enrutan por la WABA (única en la
 * instancia, H8) y corren a nombre de esa organización. Sin organización, o
 * con la organización suspendida, se guardan cifrados 7 días como los demás.
 *
 * La forma de cada `value` NO está verificada contra la documentación
 * oficial (ver docs/campanas-v2-meta.md): se lee con tolerancia.
 */
export const WABA_FIELDS = ["phone_number_quality_update", "account_update", "template_category_update"] as const;
export type WabaField = (typeof WABA_FIELDS)[number];

export function isWabaField(field: string | undefined): field is WabaField {
  return (WABA_FIELDS as readonly string[]).includes(field ?? "");
}

export async function processWabaEvent(
  field: WabaField,
  wabaId: string | null,
  value: Record<string, unknown>
): Promise<void> {
  if (!wabaId) return;
  const route = await resolveWaba(wabaId);
  if (!route) {
    await recordUnrouted({ source: "whatsapp", routeKind: "waba_id", routeKey: wabaId, field, payload: value });
    return;
  }
  if (route.orgStatus !== "active") {
    await recordUnrouted({
      source: "whatsapp",
      routeKind: "waba_id",
      routeKey: wabaId,
      field,
      payload: value,
      reason: unroutedReasonFor(route.orgStatus),
    });
    return;
  }
  const org = route.organizationId;
  await runWithOrganization(org, async () => {
    if (field === "template_category_update") {
      await applyTemplateCategoryEvent(org, value);
    } else {
      await recordHealthEvent(org, field, value);
    }
  });
  log.info("evento de la WABA aplicado", { org, campo: field });
}
