import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { isAiConfigured } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { agentConfigSchema, type AgentConfig } from "@/server/agents/config";
import { withAgentErrors } from "@/server/agents/http";
import { runPreview } from "@/server/agents/preview";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 031 — Peticiones de vista previa por persona y minuto. */
const PREVIEW_PER_MINUTE = 30;
/** Tope del cuerpo crudo: la config (≈14 KB) + el historial. */
const MAX_BODY_CHARS = 64_000;
/** Tope del texto de todo el historial junto. */
const MAX_HISTORY_CHARS = 24_000;

const bodySchema = z.object({
  agentId: z.string().min(1),
  config: agentConfigSchema,
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(2000) }))
    .max(20)
    .refine((h) => h.reduce((n, m) => n + m.text.length, 0) <= MAX_HISTORY_CHARS, {
      message: `el historial no puede pasar de ${MAX_HISTORY_CHARS} caracteres`,
    }),
  message: z.string().trim().min(1).max(2000),
});

/**
 * 031 — Vista previa del editor: responde el agente con la config del
 * formulario (aunque no esté guardada). No guarda NADA salvo la cuota de IA;
 * las acciones vuelven como chips (src/server/agents/preview.ts).
 */
export const POST = withAuth(async (session, req: Request) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  if (!isAiConfigured()) {
    return apiError(409, "ai_not_configured", "Configura tu proveedor de IA para probar al agente");
  }
  const limit = checkRateLimit(`lab-preview:${session.userId}`, { windowMs: 60_000, max: PREVIEW_PER_MINUTE });
  if (!limit.allowed) {
    return apiError(
      429,
      "preview_rate_limited",
      `Vas muy rápido: la vista previa admite ${PREVIEW_PER_MINUTE} mensajes por minuto. Espera un momento.`
    );
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return apiError(413, "body_too_large", "La conversación de prueba es demasiado larga; reiníciala");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return apiError(422, "invalid_body", "El body debe ser JSON válido");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return apiError(422, "invalid_body", detail);
  }

  return withAgentErrors(async () => {
    const result = await runPreview({
      organizationId: session.organizationId,
      agentId: parsed.data.agentId,
      config: parsed.data.config as AgentConfig,
      history: parsed.data.history,
      message: parsed.data.message,
    });
    if (!result.ok) {
      return result.error === "quota_exceeded"
        ? apiError(429, "quota_exceeded", "Se agotó la cuota mensual de IA de tu negocio")
        : apiError(409, "ai_not_configured", "Configura tu proveedor de IA para probar al agente");
    }
    return Response.json(result);
  });
}, { permission: "agent.manage" });
