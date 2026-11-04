import { z } from "zod";
import { parseBody } from "@/lib/api";
import { AI_ROLES } from "@/lib/costs";
import { probeModel, probeRole } from "@/lib/ai/probe";
import { withPlatformAdmin } from "@/server/platform-admin/http";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const schema = z.union([
  z.object({ role: z.enum(AI_ROLES) }).strict(),
  // 0070: un modelo por su nombre (el elegido en «Modelos de Dashfort»).
  z.object({ model: z.string().trim().min(1).max(200).regex(/^[\w.:/@-]+$/) }).strict(),
]);

/**
 * «Probar conexión»: una llamada mínima al modelo de esa función. Devuelve
 * solo OK/error y latencia. No cuenta en la cuota de ninguna organización.
 */
export const POST = withPlatformAdmin(async (admin, ip, req) => {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const limited = checkRateLimit(`platform-ai-probe:${admin.userId}`, { windowMs: 60_000, max: 20 });
  if (!limited.allowed) return Response.json({ error: "rate_limited", message: "Demasiadas pruebas seguidas: espera un minuto." }, { status: 429 });
  const result = "model" in body.data ? await probeModel(body.data.model) : await probeRole(body.data.role);
  return Response.json({ result });
});
