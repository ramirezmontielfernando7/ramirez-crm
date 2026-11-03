import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveProposals } from "@/server/assistant/apply";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

const body = z.object({
  threadId: z.string().min(1).max(64),
  messageId: z.string().min(1).max(64),
  action: z.enum(["apply", "cancel"]),
  ids: z.array(z.string().min(1).max(20)).max(20).optional(),
});

/**
 * Aplicar o descartar los cambios que el asistente propuso en una respuesta.
 * Corren con la sesión de quien pulsa, por las mismas herramientas del
 * conector (mismos permisos y mismas puertas del CRM que la pantalla).
 */
export const POST = withAuth(
  async (session, req: Request) => {
    const off = await moduleOff(session.organizationId, "asistente");
    if (off) return off;
    const limit = checkRateLimit(`assistant-actions:${session.userId}`, { windowMs: 60_000, max: 20 });
    if (!limit.allowed) return apiError(429, "assistant_rate_limited", "Vas muy rápido. Espera un momento.");
    const parsed = await parseBody(req, body);
    if (!parsed.ok) return parsed.response;
    const r = await resolveProposals({ session, ...parsed.data });
    if (!r.ok) return apiError(r.status, r.code, r.message);
    return Response.json({ proposals: r.proposals });
  },
  { permission: "assistant.use" }
);
