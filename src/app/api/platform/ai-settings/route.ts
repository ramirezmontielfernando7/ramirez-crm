import { z } from "zod";
import { parseBody } from "@/lib/api";
import { AI_EFFORTS } from "@/lib/ai/choice";
import { changeModelPrice, changePlatformAiDefaults, getAiSettingsOverview } from "@/server/ai-settings/admin";
import { AI_DEFAULT_SCOPES } from "@/server/ai-settings/platform";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

/**
 * 0070 — «Modelos de IA» de la plataforma: los de la instancia (los de
 * Dashfort) y los de cada plan, su tope en dólares, el precio de cada modelo
 * y el presupuesto contra los créditos. Solo el administrador de plataforma
 * (404 a los demás).
 */
export const GET = withPlatformAdmin(async () => Response.json(await getAiSettingsOverview()));

/** Un modelo: el id del proveedor (p. ej. `global.openai.gpt-6-luna`); `null` = heredar. */
const modelo = z.string().trim().min(1).max(200).regex(/^[\w.:/@-]+$/, "Nombre de modelo no válido").nullable().optional();
const esfuerzo = z.enum(AI_EFFORTS).nullable().optional();
const usd = z.number().min(0).max(1_000_000).nullable().optional();
const precio = z.number().min(0).max(1000);

const schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("defaults"),
      scope: z.enum(AI_DEFAULT_SCOPES),
      agentModel: modelo,
      agentEffort: esfuerzo,
      creatorModel: modelo,
      creatorEffort: esfuerzo,
      assistantModel: modelo,
      monthlyUsdLimit: usd,
      // Solo la instancia: presupuesto mensual y créditos (para el panel).
      budgetMonthlyUsd: usd,
      creditsUsd: usd,
      creditsSince: z.string().regex(/^\d{4}-\d{2}-01$/, "Primer día del mes (AAAA-MM-01)").nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("price"),
      model: z.string().trim().min(1).max(200).regex(/^[\w.:/@-]+$/, "Nombre de modelo no válido"),
      price: z.object({ inputUsdPerMtok: precio, outputUsdPerMtok: precio }).strict().nullable(),
    })
    .strict(),
]);

export const PUT = withPlatformAdmin(async (admin, ip, req) => {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  if (body.data.kind === "price") {
    await changeModelPrice(body.data.model, body.data.price, actorOf(admin), ip);
  } else {
    const { kind: _k, scope, ...patch } = body.data;
    if (scope !== "instance") {
      delete patch.budgetMonthlyUsd;
      delete patch.creditsUsd;
      delete patch.creditsSince;
    }
    await changePlatformAiDefaults(scope, patch, actorOf(admin), ip);
  }
  return Response.json(await getAiSettingsOverview());
});
