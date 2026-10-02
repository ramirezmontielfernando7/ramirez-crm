import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { parseBody } from "@/lib/api";
import { getWaMockState, nextTemplateId, type MockTemplate } from "@/server/dev/wa-mock-state";

export const dynamic = "force-dynamic";

/**
 * Campañas v2 — Siembra una plantilla que YA existe en la WABA y nunca pasó
 * por el CRM (creada en el Administrador de WhatsApp): la sincronización
 * debe importarla con sus componentes completos.
 */
const bodySchema = z.object({
  wabaId: z.string().min(1),
  name: z.string().min(1),
  language: z.string().default("es_MX"),
  category: z.string().default("MARKETING"),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "PAUSED", "DISABLED"]).default("APPROVED"),
  components: z.array(z.record(z.unknown())).min(1),
  qualityScore: z.string().optional(),
  rejectedReason: z.string().optional(),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const d = body.data;
  const bodyComponent = d.components.find((c) => String(c.type ?? "").toUpperCase() === "BODY");
  const tpl: MockTemplate = {
    id: nextTemplateId(),
    wabaId: d.wabaId,
    name: d.name,
    language: d.language ?? "es_MX",
    category: d.category ?? "MARKETING",
    status: d.status ?? "APPROVED",
    body: String(bodyComponent?.text ?? ""),
    components: d.components,
    qualityScore: d.qualityScore,
    rejectedReason: d.rejectedReason,
  };
  getWaMockState().templates.push(tpl);
  return Response.json({ template: tpl }, { status: 201 });
}
