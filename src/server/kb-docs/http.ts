import { apiError } from "@/lib/api";
import { KB_DOC_ERROR_LABEL, statusLabel, type KbDocErrorCode } from "@/lib/kb-docs";
import { embeddingsAvailable } from "@/server/ai-quota/embed";
import { toDto, type KbDocument } from "./store";

/** 035 — Código de error → HTTP + mensaje para el dueño. */
const STATUS: Record<KbDocErrorCode, number> = {
  unsupported: 415,
  too_large: 413,
  too_long: 422,
  empty: 422,
  no_text: 422,
  encrypted: 422,
  unreadable: 422,
  duplicate: 409,
  document_limit: 409,
  chunk_limit: 409,
  internal: 500,
};

export function kbDocError(code: KbDocErrorCode, message?: string): Response {
  return apiError(STATUS[code], code, message ?? KB_DOC_ERROR_LABEL[code]);
}

/** Lo que recibe la pantalla por documento (con el estado y el motivo en palabras). */
export function documentView(d: KbDocument) {
  const dto = toDto(d);
  return {
    ...dto,
    statusLabel: statusLabel(dto, embeddingsAvailable()),
    errorMessage: dto.errorCode ? (KB_DOC_ERROR_LABEL[dto.errorCode as KbDocErrorCode] ?? KB_DOC_ERROR_LABEL.internal) : null,
  };
}

export type KbDocumentView = ReturnType<typeof documentView>;
