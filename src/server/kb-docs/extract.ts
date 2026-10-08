import { decodeText, detectFormat, normalizeText, type KbDocErrorCode, type KbDocMime } from "@/lib/kb-docs";
import { logger } from "@/lib/log";

/**
 * 035 — Del archivo subido a texto. Solo .txt, .md y .pdf con capa de texto
 * (unpdf: JavaScript puro, sin binarios nativos). Nada de OCR: un PDF
 * escaneado sale como `no_text`. El archivo no se guarda: solo lo que sale de
 * aquí.
 */

const log = logger("kb-docs");

export type Extracted = { ok: true; mime: KbDocMime; text: string } | { ok: false; code: KbDocErrorCode };

export async function extractDocumentText(filename: string, bytes: Uint8Array): Promise<Extracted> {
  if (bytes.length === 0) return { ok: false, code: "empty" };
  const format = detectFormat(filename, bytes.subarray(0, 8));
  if (!format.ok) return { ok: false, code: "unsupported" };

  if (format.mime !== "application/pdf") {
    const text = decodeText(bytes);
    if (text === null) return { ok: false, code: "unsupported" };
    const clean = normalizeText(text);
    return clean ? { ok: true, mime: format.mime, text: clean } : { ok: false, code: "empty" };
  }

  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    // Copia: pdf.js puede quedarse con el buffer.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = normalizeText(Array.isArray(text) ? text.join("\n\n") : text);
    return clean.replace(/\s/g, "").length >= 20 ? { ok: true, mime: format.mime, text: clean } : { ok: false, code: "no_text" };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException" || /password/i.test(err instanceof Error ? err.message : "")) {
      return { ok: false, code: "encrypted" };
    }
    log.warn("no se pudo leer un PDF", { error: name || "desconocido" });
    return { ok: false, code: "unreadable" };
  }
}
