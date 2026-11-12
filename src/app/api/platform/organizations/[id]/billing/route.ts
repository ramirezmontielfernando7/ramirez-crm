import { z } from "zod";
import { parseBody } from "@/lib/api";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";
import { changeBillingSettings, changeTrial, getOrgBilling } from "@/server/platform-admin/billing";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 048 — Cobro a mano de una organización: prueba gratis, «pagado hasta»,
 * días de gracia y nota interna; y su bitácora de pagos. Solo el
 * administrador de plataforma (404 a los demás).
 */
export const GET = withPlatformAdmin(async (_admin, _ip, _req, { params }: Params) => {
  const { id } = await params;
  return Response.json({ billing: await getOrgBilling(id) });
});

const fecha = z.string().datetime({ offset: true });

const schema = z
  .object({
    /** Prueba de N días desde hoy. */
    trialDays: z.number().int().min(1).max(90).optional(),
    /** Fecha exacta de fin de la prueba; `null` = quitarla. */
    trialEndsAt: fecha.nullable().optional(),
    paidUntil: fecha.nullable().optional(),
    graceDays: z.number().int().min(0).max(60).optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();

export const PUT = withPlatformAdmin(async (admin, ip, req, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { trialDays, trialEndsAt, paidUntil, graceDays, note } = body.data;
  let billing = null;
  if (trialDays !== undefined) billing = await changeTrial(id, { days: trialDays }, actorOf(admin), ip);
  else if (trialEndsAt !== undefined) billing = await changeTrial(id, { endsAt: trialEndsAt ? new Date(trialEndsAt) : null }, actorOf(admin), ip);
  if (paidUntil !== undefined || graceDays !== undefined || note !== undefined) {
    billing = await changeBillingSettings(
      id,
      {
        ...(paidUntil !== undefined ? { paidUntil: paidUntil ? new Date(paidUntil) : null } : {}),
        ...(graceDays !== undefined ? { graceDays } : {}),
        ...(note !== undefined ? { note } : {}),
      },
      actorOf(admin),
      ip
    );
  }
  return Response.json({ billing: billing ?? (await getOrgBilling(id)) });
});
