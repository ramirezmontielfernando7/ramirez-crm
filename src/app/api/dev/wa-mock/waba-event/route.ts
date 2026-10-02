import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { buildWabaEventPayload, deliverToWebhook } from "@/server/dev/wa-mock-inbound";
import { getWaMockState } from "@/server/dev/wa-mock-state";

export const dynamic = "force-dynamic";

/**
 * Campañas v2 — Entrega un evento a nivel WABA al webhook de la app:
 * `phone_number_quality_update`, `account_update` o
 * `template_category_update`. Con `template_category_update` también mueve
 * la categoría en el panel simulado (para que el sync coincida).
 */
const bodySchema = z.object({
  wabaId: z.string().min(1),
  field: z.enum(["phone_number_quality_update", "account_update", "template_category_update"]),
  value: z.record(z.unknown()),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  if (body.data.field === "template_category_update") {
    const v = body.data.value;
    const tpl = getWaMockState().templates.find(
      (t) => t.id === String(v.message_template_id ?? "") || t.name === String(v.message_template_name ?? "")
    );
    if (tpl && typeof v.new_category === "string") tpl.category = v.new_category;
  }
  const res = await deliverToWebhook(buildWabaEventPayload(body.data));
  return res.ok
    ? Response.json({ delivered: true })
    : apiError(502, "webhook_error", `El webhook respondió ${res.status}`);
}
