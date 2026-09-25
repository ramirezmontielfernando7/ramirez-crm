import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  KNOWLEDGE_BODY_MAX,
  KNOWLEDGE_FILE_MAX_BYTES,
  KNOWLEDGE_TAGS_MAX,
  KNOWLEDGE_TITLE_MAX,
  parseTags,
} from "@/lib/knowledge";
import type { KnowledgeFileInput } from "./store";

/**
 * 024 — Lee el cuerpo de crear/editar una entrada. Acepta multipart (la UI,
 * con archivo) o JSON (solo texto; útil para integraciones y pruebas).
 *
 * `file`: objeto = archivo nuevo · `null` = quitarlo (`removeFile=true`) ·
 * `undefined` = no se tocó.
 */
export type KnowledgeInput = {
  title?: string;
  body?: string;
  tags?: string[];
  file?: KnowledgeFileInput | null;
};

const fieldsSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio").max(KNOWLEDGE_TITLE_MAX).optional(),
  body: z.string().trim().max(KNOWLEDGE_BODY_MAX).optional(),
  tags: z.union([z.string(), z.array(z.string()).max(KNOWLEDGE_TAGS_MAX * 2)]).optional(),
  removeFile: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
});

/** Nombre y MIME del archivo: los navegadores a veces mandan `.docx` sin tipo. */
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function mimeOf(file: File): string {
  // Sin tipo, el multipart lo entrega como octet-stream: se deduce por extensión.
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export async function readKnowledgeInput(
  req: Request
): Promise<{ ok: true; data: KnowledgeInput } | { ok: false; response: Response }> {
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  let raw: Record<string, unknown> = {};
  let file: File | null = null;

  if (isJson) {
    const json = (await req.json().catch(() => null)) as unknown;
    if (!json || typeof json !== "object") {
      return { ok: false, response: apiError(422, "invalid_body", "El body debe ser JSON válido") };
    }
    raw = json as Record<string, unknown>;
  } else {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return { ok: false, response: apiError(400, "invalid", "Se esperaba multipart/form-data o JSON") };
    }
    for (const key of ["title", "body", "tags", "removeFile"]) {
      const v = form.get(key);
      if (typeof v === "string") raw[key] = v;
    }
    const f = form.get("file");
    if (f instanceof File && f.size > 0) file = f;
  }

  const parsed = fieldsSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { ok: false, response: apiError(422, "invalid_body", detail) };
  }
  if (file && file.size > KNOWLEDGE_FILE_MAX_BYTES) {
    return { ok: false, response: apiError(413, "too_large", "El archivo excede 100 MB") };
  }

  const d = parsed.data;
  const remove = d.removeFile === true || d.removeFile === "true";
  return {
    ok: true,
    data: {
      title: d.title,
      body: d.body,
      tags: d.tags === undefined ? undefined : parseTags(d.tags),
      file: file
        ? {
            data: Buffer.from(await file.arrayBuffer()),
            mimeType: mimeOf(file),
            fileName: file.name.slice(0, 200) || "archivo",
          }
        : remove
          ? null
          : undefined,
    },
  };
}
