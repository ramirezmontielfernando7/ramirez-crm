import { MAX_QUESTION_CHARS, type AssistantMessageDto } from "@/lib/assistant-engine";
import type { Access } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { askAssistant } from "./engine";
import { getAssistantStatus } from "./status";
import { purgeOldThreads, saveExchange, threadHistory } from "./threads";

/**
 * 038 (PR 2) — Una pregunta del Propietario, de punta a punta: revisa que el
 * asistente pueda responder (módulo y permiso ya los revisó la ruta), que la
 * persona aceptó el aviso de consumo y que no tiene otra pregunta en curso;
 * corre el motor y guarda la pregunta y la respuesta con sus fuentes.
 */

const log = logger("asistente");

/** Una pregunta a la vez por persona: una sola no puede multiplicar el gasto. */
const enCurso = new Set<string>();

export type AskOutcome =
  | { ok: true; threadId: string; question: AssistantMessageDto; answer: AssistantMessageDto }
  | { ok: false; status: number; code: string; message: string };

export async function askQuestion(input: {
  organizationId: string;
  userId: string;
  access: Access;
  threadId: string | null;
  question: string;
  now?: Date;
}): Promise<AskOutcome> {
  const question = input.question.trim();
  if (!question || question.length > MAX_QUESTION_CHARS) {
    return { ok: false, status: 422, code: "invalid_question", message: `Escribe una pregunta de hasta ${MAX_QUESTION_CHARS} caracteres.` };
  }

  const status = await getAssistantStatus(input.organizationId, input.userId, input.now);
  if (!status.noticeAcceptedAt) {
    return { ok: false, status: 409, code: "notice_required", message: "Antes de preguntar, acepta el aviso de consumo del asistente." };
  }
  if (!status.canAsk) return { ok: false, status: 409, code: `assistant_${status.state}`, message: status.message };

  let history: Awaited<ReturnType<typeof threadHistory>> = [];
  if (input.threadId) {
    history = await threadHistory(input.organizationId, input.userId, input.threadId);
    if (history === null) return { ok: false, status: 404, code: "not_found", message: "Conversación no encontrada" };
  }

  const key = `${input.organizationId}:${input.userId}`;
  if (enCurso.has(key)) {
    return { ok: false, status: 429, code: "assistant_busy", message: "El asistente todavía está contestando tu pregunta anterior. Espera a que termine." };
  }
  enCurso.add(key);
  try {
    await purgeOldThreads(input.organizationId, input.userId, input.now);
    const r = await askAssistant({ organizationId: input.organizationId, access: input.access, question, history, now: input.now });
    if (!r.ok) {
      if (r.error === "quota_exceeded") {
        // Se acabó a media pregunta (o la revisión atómica lo frenó): lo mismo que dice la pantalla.
        const after = await getAssistantStatus(input.organizationId, input.userId, input.now);
        return { ok: false, status: 429, code: "quota_exceeded", message: after.canAsk ? r.detail : after.message };
      }
      if (r.error === "not_configured") return { ok: false, status: 409, code: "ai_not_configured", message: "La IA no está configurada en esta instalación." };
      return { ok: false, status: 502, code: "provider_error", message: "El asistente no pudo responder ahora por una falla del proveedor de IA. Intenta de nuevo en un momento." };
    }
    const saved = await saveExchange({
      organizationId: input.organizationId,
      userId: input.userId,
      threadId: input.threadId,
      question,
      maskedQuestion: r.maskedQuestion,
      answer: r.answer,
      maskedAnswer: r.maskedAnswer,
      meta: r.meta,
      usage: r.usage,
      now: input.now,
    });
    log.info("pregunta respondida", {
      org: input.organizationId,
      consultas: r.meta.queryCount,
      llamadas: r.meta.modelCalls,
      tokens: r.usage.promptTokens + r.usage.completionTokens,
      avisos: r.meta.flags.join(",") || undefined,
    });
    return { ok: true, ...saved };
  } finally {
    enCurso.delete(key);
  }
}
