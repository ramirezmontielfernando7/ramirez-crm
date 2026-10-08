import { createHash } from "node:crypto";
import { apiError, withAuth } from "@/lib/api";
import { groupIdFromKey, KB_DOC_ACCEPT, KB_DOC_MAX_CHARS, titleFromFilename } from "@/lib/kb-docs";
import { checkRateLimit } from "@/lib/rate-limit";
import { currentEmbeddingModel } from "@/server/ai-quota/embed";
import { extractDocumentText } from "@/server/kb-docs/extract";
import { kbDocsOff } from "@/server/kb-docs/flag";
import { documentView, kbDocError, withKbDocErrors } from "@/server/kb-docs/http";
import { scheduleIndex } from "@/server/kb-docs/indexer";
import { formatBytes, getKbDocLimits } from "@/server/kb-docs/limits";
import { createDocument, getUsage, listDocuments } from "@/server/kb-docs/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 035 — Subidas por persona y hora. */
const UPLOADS_PER_HOUR = 20;

/**
 * 035 — Laboratorio → Documentos: la lista con su estado, el uso contra los
 * límites y si hay servicio de embeddings (sin él, «solo texto»).
 * 037: `?group=general|<id>` → solo los de ese grupo (sin él, todos los de
 * la empresa).
 */
export const GET = withAuth(async (session, req: Request) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  const group = new URL(req.url).searchParams.get("group");
  const [docs, usage, limits] = await Promise.all([
    listDocuments(session.organizationId, group === null ? {} : { groupId: groupIdFromKey(group) }),
    getUsage(session.organizationId),
    getKbDocLimits(session.organizationId),
  ]);
  return Response.json({
    documents: docs.map(documentView),
    usage,
    limits: { ...limits, maxChars: KB_DOC_MAX_CHARS },
    embeddings: { enabled: currentEmbeddingModel() !== null, model: currentEmbeddingModel() },
    accept: KB_DOC_ACCEPT,
  });
}, { permission: "agent.manage" });

/**
 * 035 — Sube un documento (multipart: `file`, `title` opcional). Se valida y
 * se extrae su texto AQUÍ (para responder el motivo al momento); fragmentos y
 * vectores corren después, in-process (`indexer.ts`).
 */
export const POST = withAuth(async (session, req: Request) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  const limit = checkRateLimit(`kb-docs-upload:${session.userId}`, { windowMs: 3_600_000, max: UPLOADS_PER_HOUR });
  if (!limit.allowed) {
    return apiError(429, "upload_rate_limited", `Vas muy rápido: puedes subir ${UPLOADS_PER_HOUR} documentos por hora. Espera un poco.`);
  }

  const limits = await getKbDocLimits(session.organizationId);
  const tooLarge = () => kbDocError("too_large", `El archivo pasa del máximo de ${formatBytes(limits.maxFileBytes)}.`);
  // Antes de leer el cuerpo: un archivo enorme no llega a memoria.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > limits.maxFileBytes + 64 * 1024) return tooLarge();

  const form = await req.formData().catch(() => null);
  if (!form) return apiError(400, "invalid", "Se esperaba multipart/form-data");
  const file = form.get("file");
  if (!(file instanceof File)) return apiError(422, "invalid", "Falta el archivo (campo `file`)");
  if (file.size > limits.maxFileBytes) return tooLarge();
  if (file.size === 0) return kbDocError("empty");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = (file.name || "documento").slice(0, 255);
  const extracted = await extractDocumentText(filename, bytes);
  if (!extracted.ok) return kbDocError(extracted.code);
  if (extracted.text.length > KB_DOC_MAX_CHARS) return kbDocError("too_long");

  // 037 — El grupo («general» o ausente = General).
  const rawGroup = form.get("groupId");
  const groupId = typeof rawGroup === "string" && rawGroup.trim() ? groupIdFromKey(rawGroup.trim()) : null;

  const rawTitle = form.get("title");
  const title = (typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : titleFromFilename(filename)).slice(0, 200);

  return withKbDocErrors(async () => {
    const doc = await createDocument(session.organizationId, {
      title,
      filename,
      mime: extracted.mime,
      byteSize: bytes.length,
      text: extracted.text,
      contentSha256: createHash("sha256").update(extracted.text).digest("hex"),
      uploadedByUserId: session.userId,
      groupId,
    });
    scheduleIndex(session.organizationId, doc.id);
    return Response.json({ document: documentView(doc) }, { status: 201 });
  });
}, { permission: "agent.manage" });
