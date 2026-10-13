import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { MAX_QUESTION_CHARS } from "@/lib/assistant-engine";
import { checkRateLimit } from "@/lib/rate-limit";
import { askQuestion } from "@/server/assistant/ask";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";
/** Una pregunta puede tardar varias llamadas al modelo. */
export const maxDuration = 120;

/** 038 (PR 2) — Preguntas por persona y minuto (además de una a la vez). */
const ASK_PER_MINUTE = 6;

const body = z.object({
  threadId: z.string().min(1).max(64).nullable().optional(),
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
});

/**
 * 038 (PR 2) — Hacerle una pregunta al asistente interno. SOLO LECTURA: el
 * motor solo corre consultas del catálogo cerrado; la respuesta trae de qué
 * consultas salen sus datos. Solo el Propietario y con el módulo (404).
 */
export const POST = withAuth(
  async (session, req: Request) => {
    const off = await moduleOff(session.organizationId, "asistente");
    if (off) return off;
    const limit = checkRateLimit(`assistant-ask:${session.userId}`, { windowMs: 60_000, max: ASK_PER_MINUTE });
    if (!limit.allowed) {
      return apiError(429, "assistant_rate_limited", `Vas muy rápido: el asistente admite ${ASK_PER_MINUTE} preguntas por minuto. Espera un momento.`);
    }
    const parsed = await parseBody(req, body);
    if (!parsed.ok) return parsed.response;
    const r = await askQuestion({
      organizationId: session.organizationId,
      userId: session.userId,
      access: session.access,
      threadId: parsed.data.threadId ?? null,
      question: parsed.data.question,
    });
    if (!r.ok) return apiError(r.status, r.code, r.message);
    return Response.json({ threadId: r.threadId, question: r.question, answer: r.answer });
  },
  { permission: "assistant.use" }
);
