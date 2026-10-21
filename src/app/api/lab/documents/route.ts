import { createHash } from "node:crypto";
import { apiError, withAuth } from "@/lib/api";
import { groupIdFromKey, KB_DOC_ACCEPT, KB_DOC_MAX_CHARS, titleFromFilename } from "@/lib/kb-docs";
import { checkRateLimit } from "@/lib/rate-limit";
import { currentEmbeddingModel } from "@/server/ai-quota/embed";
import { extractDocumentText } from "@/server/kb-docs/extract";
import { kbDocsOff } from "@/server/kb-docs/flag";
import { documentView, kbDocError } from "@/server/kb-docs/http";
import { scheduleIndex } from "@/server/kb-docs/indexer";
import { formatBytes, getKbDocLimits } from "@/server/kb-docs/limits";
import { getAgent } from "@/server/agents/store";
import { createDocument, getUsage, listAgentDocuments, listDocuments } from "@/server/kb-docs/store";
import { chatStateOf } from "@/server/knowledge/store";
import { createChatCopy, discardChatCopy, libraryAccess } from "@/server/library/bridge";
import { withLibraryErrors } from "@/server/library/http";
import { assertCanUpload } from "@/server/limits";
import { checkStorageAlerts } from "@/server/limits/alerts";
import { limitBlocked } from "@/server/limits/http";
import { moduleOff } from "@/server/modules";
import { readUploadForm, withUploadSlot } from "@/server/uploads/body";

export const dynamic = "force-dynamic";

/** 035 — Subidas por persona y hora. */
const UPLOADS_PER_HOUR = 20;

/**
 * 035 — Laboratorio → Documentos: la lista con su estado, el uso contra los
 * límites y si hay servicio de embeddings (sin él, «solo texto»).
 * 037: `?group=general|<id>` → solo los de ese grupo (sin él, todos los de
 * la empresa). PR 3: `?agentId=` → los exclusivos de ese agente.
 */
export const GET = withAuth(async (session, req: Request) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  const params = new URL(req.url).searchParams;
  const group = params.get("group");
  const agentId = params.get("agentId");
  const [docs, usage, limits, library] = await Promise.all([
    agentId
      ? listAgentDocuments(session.organizationId, agentId)
      : listDocuments(session.organizationId, group === null ? {} : { groupId: groupIdFromKey(group) }),
    getUsage(session.organizationId),
    getKbDocLimits(session.organizationId),
    libraryAccess(session),
  ]);
  // 040 — «💬 Envío en chat»: si su original está en la Biblioteca y aparece en la Bandeja.
  const chat = await chatStateOf(session.organizationId, docs.flatMap((d) => (d.knowledgeEntryId ? [d.knowledgeEntryId] : [])));
  return Response.json({
    documents: docs.map((d) => ({
      ...documentView(d),
      inChat: d.knowledgeEntryId ? (chat.get(d.knowledgeEntryId) ?? false) : false,
      hasOriginal: Boolean(d.knowledgeEntryId && chat.has(d.knowledgeEntryId)),
    })),
    // 040 — ¿Se puede ofrecer «Disponible en Bandeja»? (módulo Biblioteca + `knowledge.manage`).
    library: { chat: library.chat },
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
 * 040 — `chat=true` («Disponible en Bandeja para envío rápido de asesores»):
 * además guarda el archivo en la Biblioteca (`knowledge_entry`) y los ata
 * (`kb_document.knowledge_entry_id`). Pide el módulo Biblioteca y
 * `knowledge.manage`; sin ellos, 403. Si el documento no se crea, la copia
 * tampoco se queda.
 */
export const POST = withAuth(async (session, req: Request) => {
  // 044: pocas subidas pesadas a la vez (el archivo vive en memoria todo el turno).
  return withUploadSlot(req, async () => {
    const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
    if (off) return off;
    const limit = checkRateLimit(`kb-docs-upload:${session.userId}`, { windowMs: 3_600_000, max: UPLOADS_PER_HOUR });
    if (!limit.allowed) {
      return apiError(429, "upload_rate_limited", `Vas muy rápido: puedes subir ${UPLOADS_PER_HOUR} documentos por hora. Espera un poco.`);
    }

    const limits = await getKbDocLimits(session.organizationId);
    const tooLarge = () => kbDocError("too_large", `El archivo pasa del máximo de ${formatBytes(limits.maxFileBytes)}.`);
    // Antes de leer el cuerpo (y mientras llega, 044): un archivo enorme no llega a memoria.
    const read = await readUploadForm(req, limits.maxFileBytes, tooLarge);
    if (!read.ok) return read.response;
    const form = read.form;
    const file = form.get("file");
    if (!(file instanceof File)) return apiError(422, "invalid", "Falta el archivo (campo `file`)");
    if (file.size > limits.maxFileBytes) return tooLarge();
    if (file.size === 0) return kbDocError("empty");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const filename = (file.name || "documento").slice(0, 255);
    const extracted = await extractDocumentText(filename, bytes);
    if (!extracted.ok) return kbDocError(extracted.code);
    if (extracted.text.length > KB_DOC_MAX_CHARS) return kbDocError("too_long");
    // 040 — ¿También a la Bandeja?
    const wantsChat = form.get("chat") === "true";
    if (wantsChat && !(await libraryAccess(session)).chat) {
      return apiError(403, "forbidden", "No puedes publicar en la Biblioteca de la Bandeja");
    }
    // 036 (PR 3a): con «Bloquear subidas manuales», no pasar el tope de
    // almacenamiento. Lo que ocupa: su texto y el de sus fragmentos (≈ 2 × texto)
    // y, con «Disponible en Bandeja» (040), el archivo original.
    const blocked = await limitBlocked(() =>
      assertCanUpload(session.organizationId, Buffer.byteLength(extracted.text) * 2 + (wantsChat ? bytes.length : 0))
    );
    if (blocked) return blocked;

    // 037 — El grupo («general» o ausente = General).
    const rawGroup = form.get("groupId");
    const groupId = typeof rawGroup === "string" && rawGroup.trim() ? groupIdFromKey(rawGroup.trim()) : null;
    // 037 (PR 3) — O exclusivo de un agente (activo y de esta organización).
    const rawAgent = form.get("agentId");
    const agentId = typeof rawAgent === "string" && rawAgent.trim() ? rawAgent.trim() : null;
    // Se mira el campo tal como llegó: «general» también es un grupo.
    const askedGroup = typeof rawGroup === "string" && rawGroup.trim() !== "";
    if (agentId && askedGroup) return apiError(422, "invalid", "Un documento es de un grupo o exclusivo de un agente, no las dos cosas.");
    if (agentId && !(await getAgent(session.organizationId, agentId))) return apiError(404, "agent_not_found", "Agente no encontrado");

    const rawTitle = form.get("title");
    const title = (typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : titleFromFilename(filename)).slice(0, 200);

    return withLibraryErrors(async () => {
      const copy = wantsChat
        ? await createChatCopy({ organizationId: session.organizationId, userId: session.userId, title, filename, mime: extracted.mime, bytes })
        : null;
      let doc;
      try {
        doc = await createDocument(session.organizationId, {
        title,
        filename,
        mime: extracted.mime,
        byteSize: bytes.length,
        text: extracted.text,
        contentSha256: createHash("sha256").update(extracted.text).digest("hex"),
        uploadedByUserId: session.userId,
        groupId,
        agentId,
        knowledgeEntryId: copy?.id ?? null,
      });
      } catch (err) {
        if (copy) await discardChatCopy(session.organizationId, copy.id);
        throw err;
      }
      scheduleIndex(session.organizationId, doc.id);
      void checkStorageAlerts(session.organizationId);
      return Response.json({ document: { ...documentView(doc), inChat: Boolean(copy), hasOriginal: Boolean(copy) } }, { status: 201 });
    });
  });
}, { permission: "agent.manage" });
