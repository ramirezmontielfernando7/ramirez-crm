import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey } from "@/server/bot/auth";
import { PAUSE_HANDOFF_REASON } from "@/lib/agent-pause";
import { applyHandoff } from "@/server/ai/pipeline";
import { isBrainPaused } from "@/server/agents/store";
import { SendError, sendText } from "@/server/inbox/send";
import { runWithOrganization } from "@/lib/request-context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1).max(4096),
});

/**
 * Envío del cerebro externo A TRAVÉS del CRM: el token de WhatsApp nunca sale
 * de aquí. Usa el mismo camino que el composer de la bandeja (`sendText`), así
 * que el mensaje queda en el hilo marcado como IA, respeta la ventana de 24 h
 * y hereda el guard de sandbox del Laboratorio.
 *
 * 409 tipados: ai_paused (un humano tomó la conversación, o el equipo pausó los
 * agentes: 042) · window_closed ·
 * sandbox_violation.
 */
export async function POST(req: Request) {
  // H2: la llave dice la organización; nunca "la de la instancia".
  const auth = await requireBotKey(req);
  if (!auth.ok) return auth.response;
  const { organizationId } = auth;

  // PR 3: todo lo que sigue va a nombre de la organización de la llave.
  return runWithOrganization(organizationId, async () => {
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;

    // Gate de handoff: el bot JAMÁS habla sobre una conversación pausada. Se
    // relee aquí porque entre que el bot pidió el contexto y armó su respuesta
    // (segundos de un LLM) el dueño pudo haber tomado la conversación.
    const db = getDb();
    const convs = await db
      .select({
        aiEnabled: schema.conversation.aiEnabled,
        handoffAt: schema.conversation.handoffAt,
        isTest: schema.conversation.isTest,
      })
      .from(schema.conversation)
      .where(
        scoped(schema.conversation.organizationId, organizationId,
          eq(schema.conversation.id, body.data.conversationId)
        )
      )
      .limit(1);
    const conv = convs[0];
    if (!conv) return apiError(404, "not_found", "Conversación no encontrada");
    if (!conv.aiEnabled || conv.handoffAt) {
      return apiError(409, "ai_paused", "La IA está en pausa en esta conversación");
    }

    // 042: la pausa de los agentes (general o del agente general) también
    // calla al cerebro externo. Como cualquier pausa: el chat pasa a una
    // persona (no se queda en silencio) y la respuesta es la de siempre.
    if (!conv.isTest && (await isBrainPaused(organizationId))) {
      await applyHandoff(body.data.conversationId, organizationId, PAUSE_HANDOFF_REASON);
      return apiError(409, "ai_paused", "La IA está en pausa en esta conversación");
    }

    try {
      const result = await sendText({
        conversationId: body.data.conversationId,
        organizationId,
        text: body.data.text,
        aiGenerated: true,
      });
      return Response.json({ messageId: result.messageId });
    } catch (err) {
      if (err instanceof SendError) {
        if (err.code === "window_closed") {
          return apiError(409, "window_closed", err.message);
        }
        if (err.code === "sandbox_violation") {
          return apiError(409, "sandbox_violation", err.message);
        }
        return apiError(502, err.code, err.message);
      }
      throw err;
    }
  });
}
