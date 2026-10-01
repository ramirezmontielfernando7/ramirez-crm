import { chatJsonForOrg } from "@/server/ai-quota/llm";
import {
  buildWritingMessages,
  writingResultSchema,
  type WritingRequest,
} from "./prompts";
import { logger } from "@/lib/log";

const log = logger("writing-assist");

export type RewriteResult =
  | { ok: true; text: string }
  | { ok: false; error: "not_configured" | "provider_error" | "invalid_output" | "quota_exceeded" };

/**
 * 023 — Reescribe el borrador del asesor. Nunca lanza: un hipo del proveedor
 * vuelve como error tipado y el editor conserva el texto original. El
 * borrador no se guarda ni se loguea (puede traer datos del cliente).
 */
export async function rewriteDraft(
  organizationId: string,
  req: WritingRequest
): Promise<RewriteResult> {
  // Fase 3: gasta de la cuota de IA de la organización del asesor.
  const res = await chatJsonForOrg(organizationId, "writing", writingResultSchema, buildWritingMessages(req), {
    timeoutMs: 30_000,
  });
  if (!res.ok) {
    log.warn("la reescritura falló", { accion: req.action, error: res.error });
    return { ok: false, error: res.error };
  }
  return { ok: true, text: res.data.text };
}
