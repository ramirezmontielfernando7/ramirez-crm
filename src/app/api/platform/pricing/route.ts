import { z } from "zod";
import { parseBody } from "@/lib/api";
import { addPricing, listPricing } from "@/server/costs/pricing";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

/**
 * 036 (PR 3b) — Precios de IA (USD por millón de tokens) y tipo de cambio,
 * con su historial «vigente desde». Solo el administrador de plataforma (404
 * a los demás).
 */
export const GET = withPlatformAdmin(async () => {
  return Response.json({ pricing: await listPricing() });
});

/** USD por millón de tokens: de 0 a 1000 (ningún modelo cuesta más). */
const precio = z.number().min(0).max(1000);

const schema = z
  .object({
    chatInputUsdPerMtok: precio,
    chatOutputUsdPerMtok: precio,
    judgeInputUsdPerMtok: precio.nullable(),
    judgeOutputUsdPerMtok: precio.nullable(),
    embedUsdPerMtok: precio,
    usdToLocal: z.number().gt(0).max(100_000),
    localCurrency: z.string().regex(/^[A-Z]{3}$/, "Moneda de 3 letras (MXN, USD, COP…)"),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "Fecha no válida").optional(),
  })
  .strict();

/** Un precio nuevo: nunca reescribe los anteriores (el historial queda). */
export const POST = withPlatformAdmin(async (admin, ip, req) => {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const pricing = await addPricing(body.data, actorOf(admin), ip);
  return Response.json({ pricing }, { status: 201 });
});
