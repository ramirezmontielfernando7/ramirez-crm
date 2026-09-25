import { chatJson } from "@/lib/ai";
import {
  buildWritingMessages,
  writingResultSchema,
  type WritingRequest,
} from "./prompts";

export type RewriteResult =
  | { ok: true; text: string }
  | { ok: false; error: "not_configured" | "provider_error" | "invalid_output" };

/**
 * 023 — Reescribe el borrador del asesor. Nunca lanza: un hipo del proveedor
 * vuelve como error tipado y el editor conserva el texto original. El
 * borrador no se guarda ni se loguea (puede traer datos del cliente).
 */
export async function rewriteDraft(req: WritingRequest): Promise<RewriteResult> {
  const res = await chatJson(writingResultSchema, buildWritingMessages(req), {
    timeoutMs: 30_000,
  });
  if (!res.ok) {
    console.warn(`[writing-assist] ${req.action} falló: ${res.error}`);
    return { ok: false, error: res.error };
  }
  return { ok: true, text: res.data.text };
}
