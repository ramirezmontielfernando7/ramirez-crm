import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { parseBody } from "@/lib/api";
import { getWaMockState } from "@/server/dev/wa-mock-state";

export const dynamic = "force-dynamic";

/**
 * Campañas v2 — Fija la salud de un número en el "panel de Meta" simulado
 * (lo que devuelve `GET {phone}?fields=quality_rating,…`). Sin entrada, el
 * número está sano. `reset: true` lo devuelve al estado sano.
 */
const bodySchema = z.object({
  phoneNumberId: z.string().min(1),
  quality_rating: z.string().optional(),
  status: z.string().optional(),
  name_status: z.string().optional(),
  throughput: z.object({ level: z.string().optional() }).optional(),
  messaging_limit_tier: z.string().optional(),
  whatsapp_business_manager_messaging_limit: z.string().optional(),
  rejectNewFields: z.boolean().optional(),
  reset: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { phoneNumberId, reset, ...health } = body.data;
  const state = getWaMockState();
  state.phoneHealth ??= {};
  state.phoneHealth[phoneNumberId] = reset ? {} : { ...state.phoneHealth[phoneNumberId], ...health };
  return Response.json({ health: state.phoneHealth[phoneNumberId] });
}
