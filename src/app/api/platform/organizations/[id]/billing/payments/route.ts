import { z } from "zod";
import { parseBody } from "@/lib/api";
import { PAYMENT_KINDS } from "@/lib/billing";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";
import { recordPayment } from "@/server/platform-admin/billing";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z
  .object({
    kind: z.enum(PAYMENT_KINDS),
    amountMxn: z.number().int().min(0).max(10_000_000),
    months: z.number().int().min(1).max(36).nullable().optional(),
    quantity: z.number().int().min(1).max(100).optional(),
    note: z.string().max(300).nullable().optional(),
  })
  .strict();

/**
 * 048 — Registrar un pago (mensualidad o extra) y aplicar su efecto en el
 * acto: alarga «pagado hasta», restablece la IA del mes, suma una persona o
 * 50 GB. Solo el administrador de plataforma (404 a los demás).
 */
export const POST = withPlatformAdmin(async (admin, ip, req, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  return Response.json({ billing: await recordPayment(id, body.data, actorOf(admin), ip) }, { status: 201 });
});
