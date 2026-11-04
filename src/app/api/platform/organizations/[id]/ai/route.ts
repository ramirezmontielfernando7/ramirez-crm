import { z } from "zod";
import { parseBody } from "@/lib/api";
import { AI_EFFORTS } from "@/lib/ai/choice";
import { changeOrgAi, getOrgAiView } from "@/server/ai-settings/admin";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 0070 — Modelo y esfuerzo por función y tope mensual de IA en dólares de
 * UNA organización: lo propio, lo que hereda de su plan y lo que aplica. Solo
 * el administrador de plataforma (404 a los demás).
 */
export const GET = withPlatformAdmin(async (_admin, _ip, _req, { params }: Params) => {
  const { id } = await params;
  return Response.json(await getOrgAiView(id));
});

const modelo = z.string().trim().min(1).max(200).regex(/^[\w.:/@-]+$/, "Nombre de modelo no válido").nullable().optional();
const esfuerzo = z.enum(AI_EFFORTS).nullable().optional();

const schema = z
  .object({
    agentModel: modelo,
    agentEffort: esfuerzo,
    creatorModel: modelo,
    creatorEffort: esfuerzo,
    assistantModel: modelo,
    monthlyUsdLimit: z.number().min(0).max(1_000_000).nullable().optional(),
  })
  .strict();

/** `null` = heredar del plan (o de la instancia). Ausente = no tocar. */
export const PUT = withPlatformAdmin(async (admin, ip, req, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  return Response.json(await changeOrgAi(id, body.data, actorOf(admin), ip));
});
