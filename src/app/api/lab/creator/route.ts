import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { isAiConfigured } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { agentConfigSchema, type AgentConfig } from "@/server/agents/config";
import { runCreatorTurn } from "@/server/agents/creator";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

const PER_MINUTE = 20;
const MAX_BODY_CHARS = 64_000;
const MAX_HISTORY_CHARS = 24_000;

const bodySchema = z.object({
  config: agentConfigSchema,
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(4000) }))
    .max(30)
    .refine((h) => h.reduce((n, m) => n + m.text.length, 0) <= MAX_HISTORY_CHARS, { message: "la conversación es demasiado larga" }),
  message: z.string().trim().min(1).max(2000),
});

/**
 * Creador conversacional del agente: un turno del chat de la izquierda.
 * No guarda nada (solo la cuota de IA); devuelve el mensaje y los cambios
 * que la pantalla pone en el borrador del formulario.
 */
export const POST = withAuth(async (session, req: Request) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  if (!isAiConfigured()) return apiError(409, "ai_not_configured", "Configura tu proveedor de IA para usar el creador");
  const limit = checkRateLimit(`lab-creator:${session.userId}`, { windowMs: 60_000, max: PER_MINUTE });
  if (!limit.allowed) return apiError(429, "creator_rate_limited", `Vas muy rápido: el creador admite ${PER_MINUTE} mensajes por minuto. Espera un momento.`);

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return apiError(413, "body_too_large", "La conversación es demasiado larga; empieza una nueva");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return apiError(422, "invalid_body", "El body debe ser JSON válido");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return apiError(422, "invalid_body", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }

  const result = await runCreatorTurn({
    organizationId: session.organizationId,
    config: parsed.data.config as AgentConfig,
    history: parsed.data.history,
    message: parsed.data.message,
  });
  if (!result.ok) {
    if (result.error === "quota_exceeded") return apiError(429, "quota_exceeded", "Se agotó la cuota mensual de IA de tu negocio");
    if (result.error === "not_configured") return apiError(409, "ai_not_configured", "Configura tu proveedor de IA para usar el creador");
    return apiError(502, "provider_error", "El creador no pudo responder. Inténtalo de nuevo.");
  }
  return Response.json(result);
}, { permission: "agent.manage" });
