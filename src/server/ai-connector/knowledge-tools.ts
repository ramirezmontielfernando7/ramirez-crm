import { createHash } from "node:crypto";
import { z } from "zod";
import { GENERAL_GROUP_NAME, KB_DOC_ERROR_LABEL, KB_DOC_MAX_CHARS, KB_GROUP_ERROR_LABEL } from "@/lib/kb-docs";
import type { ToolOutcome, ToolSpec } from "@/server/ai-connector/tools";
import { createKbEntry, KbError, listKbEntries, updateKbEntry } from "@/server/agents/kb";
import { getAgent } from "@/server/agents/store";
import { documentView } from "@/server/kb-docs/http";
import { orgHasKbDocs } from "@/server/kb-docs/flag";
import { scheduleIndex } from "@/server/kb-docs/indexer";
import { createDocument, getDocument, KbDocError, KbGroupError, listAgentDocuments, listDocuments, listGroups } from "@/server/kb-docs/store";
import { assertCanUpload, LimitError } from "@/server/limits";
import { checkStorageAlerts } from "@/server/limits/alerts";
import { orgHasModule } from "@/server/modules";

/**
 * 047 — Conocimiento del Estudio de IA para la IA conectada: lo que el agente
 * sabe (preguntas y respuestas, bloques de texto) y sus documentos (RAG). Es
 * parte de «Ajustar agentes de IA» en Funciones avanzadas (`area: "agents"`)
 * y pide `agent.manage`, como la pantalla. Por las puertas de siempre
 * (`agents/kb.ts`, `kb-docs/store.ts`). Sin borrar: eso sigue en la pantalla.
 * Ojo: el conocimiento aplica al momento (no tiene borrador).
 */

function fail(error: string, summary: string): ToolOutcome {
  return { data: { ok: false, error }, summary, isError: true };
}

const agentOn = (org: string) => orgHasModule(org, "agent");

/** El agente indicado existe (o null = el conocimiento compartido). */
async function agentOrShared(organizationId: string, agentId: string | undefined) {
  if (!agentId) return { ok: true as const, agentId: null, name: "compartido" };
  const a = await getAgent(organizationId, agentId);
  return a ? { ok: true as const, agentId: a.id, name: a.internalName } : { ok: false as const };
}

const NO_AGENT = fail("No existe ese agente. Revisa list_agents.", "agente no encontrado");

/* ============================== Preguntas y bloques ============================== */

const listArgs = z.object({ agent_id: z.string().min(1).max(60).optional() });

const listKnowledge: ToolSpec<z.infer<typeof listArgs>> = {
  name: "list_knowledge",
  title: "Ver el conocimiento de un agente",
  description:
    "Lo que sabe un agente: preguntas y respuestas y bloques de texto. Sin agent_id, el conocimiento COMPARTIDO (lo leen todos los agentes que lo usan); con agent_id, el propio de ese agente.",
  inputSchema: { type: "object", properties: { agent_id: { type: "string" } }, additionalProperties: false },
  parse: listArgs,
  scope: "read",
  permission: "agent.manage",
  area: "agents",
  available: agentOn,
  run: async ({ session }, args) => {
    const owner = await agentOrShared(session.organizationId, args.agent_id);
    if (!owner.ok) return NO_AGENT;
    const rows = await listKbEntries(session.organizationId, owner.agentId);
    return {
      data: {
        owner: owner.name,
        entries: rows.map((e) =>
          e.kind === "qa" ? { id: e.id, kind: "qa", question: e.question, answer: e.answer } : { id: e.id, kind: "block", content: e.content }
        ),
      },
      summary: `${rows.length} entradas (${owner.name})`,
    };
  },
};

const addArgs = z
  .object({
    agent_id: z.string().min(1).max(60).optional(),
    question: z.string().trim().min(1).max(500).optional(),
    answer: z.string().trim().min(1).max(4000).optional(),
    content: z.string().trim().min(1).max(8000).optional(),
  })
  .refine((a) => (a.question && a.answer && !a.content) || (a.content && !a.question && !a.answer), "Manda question + answer, o content");

const addKnowledge: ToolSpec<z.infer<typeof addArgs>> = {
  name: "add_knowledge",
  title: "Agregar conocimiento a un agente",
  description:
    "Agrega una pregunta con su respuesta (question + answer) o un bloque de texto (content). Sin agent_id va al conocimiento compartido. Aplica al momento, sin publicar.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string" },
      question: { type: "string", maxLength: 500 },
      answer: { type: "string", maxLength: 4000 },
      content: { type: "string", maxLength: 8000 },
    },
    additionalProperties: false,
  },
  parse: addArgs,
  scope: "write",
  permission: "agent.manage",
  area: "agents",
  available: agentOn,
  run: async ({ session }, args) => {
    const owner = await agentOrShared(session.organizationId, args.agent_id);
    if (!owner.ok) return NO_AGENT;
    try {
      const entry = await createKbEntry(
        session.organizationId,
        args.content
          ? { kind: "block", content: args.content, agentId: owner.agentId }
          : { kind: "qa", question: args.question!, answer: args.answer!, agentId: owner.agentId }
      );
      return { data: { ok: true, id: entry.id }, summary: `agregó conocimiento (${owner.name})` };
    } catch (err) {
      if (err instanceof KbError) return NO_AGENT;
      throw err;
    }
  },
};

const updateArgs = z
  .object({
    entry_id: z.string().min(1).max(60),
    question: z.string().trim().min(1).max(500).optional(),
    answer: z.string().trim().min(1).max(4000).optional(),
    content: z.string().trim().min(1).max(8000).optional(),
  })
  .refine((a) => a.question || a.answer || a.content, "Indica qué cambiar");

const updateKnowledge: ToolSpec<z.infer<typeof updateArgs>> = {
  name: "update_knowledge",
  title: "Editar conocimiento",
  description: "Cambia una entrada de list_knowledge (pregunta, respuesta o bloque). Aplica al momento.",
  inputSchema: {
    type: "object",
    properties: {
      entry_id: { type: "string" },
      question: { type: "string", maxLength: 500 },
      answer: { type: "string", maxLength: 4000 },
      content: { type: "string", maxLength: 8000 },
    },
    required: ["entry_id"],
    additionalProperties: false,
  },
  parse: updateArgs,
  scope: "write",
  permission: "agent.manage",
  area: "agents",
  available: agentOn,
  run: async ({ session }, args) => {
    const patch = {
      ...(args.question ? { question: args.question } : {}),
      ...(args.answer ? { answer: args.answer } : {}),
      ...(args.content ? { content: args.content } : {}),
    };
    const row = await updateKbEntry(session.organizationId, args.entry_id, patch);
    if (!row) return fail("No existe esa entrada. Revisa list_knowledge.", "entrada no encontrada");
    if ((row.kind === "qa" && args.content) || (row.kind === "block" && (args.question || args.answer))) {
      return { data: { ok: true, note: "Se guardó solo lo que corresponde a su tipo." }, summary: "editó conocimiento" };
    }
    return { data: { ok: true }, summary: "editó conocimiento" };
  },
};

/* ============================== Documentos ============================== */

const docsOn = (org: string) => orgHasKbDocs(org);

const listDocsArgs = z.object({ agent_id: z.string().min(1).max(60).optional() });

const listDocumentsTool: ToolSpec<z.infer<typeof listDocsArgs>> = {
  name: "list_documents",
  title: "Ver documentos de los agentes",
  description:
    "Los documentos que consultan los agentes (PDF, texto…), con su grupo y si ya están listos para usarse. Sin agent_id, los de la empresa; con agent_id, los exclusivos de ese agente. También lista los grupos.",
  inputSchema: { type: "object", properties: { agent_id: { type: "string" } }, additionalProperties: false },
  parse: listDocsArgs,
  scope: "read",
  permission: "agent.manage",
  area: "agents",
  available: docsOn,
  run: async ({ session }, args) => {
    const org = session.organizationId;
    if (args.agent_id && !(await getAgent(org, args.agent_id))) return NO_AGENT;
    const [docs, groups] = await Promise.all([
      args.agent_id ? listAgentDocuments(org, args.agent_id) : listDocuments(org),
      listGroups(org),
    ]);
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    return {
      data: {
        groups: groups.map((g) => ({ id: g.id, name: g.name, documents: g.documents })),
        documents: docs.map((d) => {
          const v = documentView(d);
          return {
            id: v.id,
            title: v.title,
            filename: v.filename,
            group: v.agentId ? null : (groupName.get(v.groupId) ?? GENERAL_GROUP_NAME),
            status: v.statusLabel,
            error: v.errorMessage,
            characters: v.charCount,
          };
        }),
      },
      summary: `${docs.length} documentos`,
    };
  },
};

const readDocArgs = z.object({
  document_id: z.string().min(1).max(60),
  offset: z.number().int().min(0).default(0),
});
const READ_PAGE = 20_000;

const readDocumentTool: ToolSpec<z.infer<typeof readDocArgs>> = {
  name: "read_document",
  title: "Leer un documento",
  description: `El texto que el agente lee de un documento, de ${READ_PAGE.toLocaleString("es-MX")} en ${READ_PAGE.toLocaleString("es-MX")} caracteres (usa offset para seguir).`,
  inputSchema: {
    type: "object",
    properties: { document_id: { type: "string" }, offset: { type: "integer", minimum: 0 } },
    required: ["document_id"],
    additionalProperties: false,
  },
  parse: readDocArgs,
  scope: "read",
  permission: "agent.manage",
  area: "agents",
  available: docsOn,
  run: async ({ session }, args) => {
    const d = await getDocument(session.organizationId, args.document_id);
    if (!d) return fail("No existe ese documento. Revisa list_documents.", "documento no encontrado");
    const text = d.text.slice(args.offset, args.offset + READ_PAGE);
    const next = args.offset + READ_PAGE < d.text.length ? args.offset + READ_PAGE : null;
    return {
      data: { id: d.id, title: d.title, total_characters: d.text.length, offset: args.offset, next_offset: next, text },
      summary: `leyó «${d.title}»`,
    };
  },
};

const addDocArgs = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(KB_DOC_MAX_CHARS),
  group: z.string().trim().min(1).max(60).optional(),
  agent_id: z.string().min(1).max(60).optional(),
});

const addDocumentTool: ToolSpec<z.infer<typeof addDocArgs>> = {
  name: "add_document",
  title: "Cargar un documento",
  description:
    "Carga un documento de texto para que los agentes lo consulten (por ejemplo, el contenido de un PDF o Word que te pasó la persona, ya en texto). Va al grupo indicado por nombre (sin group, a General) o, con agent_id, como exclusivo de ese agente. Queda listo en unos minutos. Solo lo lee la IA del CRM: para que aparezca en la Biblioteca con etiquetas (y se pueda mandar en el chat), usa add_to_library con rag=true.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: 200 },
      text: { type: "string", maxLength: KB_DOC_MAX_CHARS },
      group: { type: "string", description: "Nombre del grupo (list_documents)" },
      agent_id: { type: "string" },
    },
    required: ["title", "text"],
    additionalProperties: false,
  },
  parse: addDocArgs,
  scope: "write",
  permission: "agent.manage",
  area: "agents",
  serial: true,
  available: docsOn,
  run: async ({ session }, args) => {
    const org = session.organizationId;
    if (args.agent_id && args.group) return fail("Un documento es de un grupo o exclusivo de un agente, no las dos cosas.", "grupo y agente");
    if (args.agent_id && !(await getAgent(org, args.agent_id))) return NO_AGENT;
    let groupId: string | null = null;
    if (args.group && args.group.toLocaleLowerCase("es") !== GENERAL_GROUP_NAME.toLocaleLowerCase("es")) {
      const groups = await listGroups(org);
      const g = groups.find((x) => x.id && x.name.toLocaleLowerCase("es") === args.group!.toLocaleLowerCase("es"));
      if (!g) return fail(`No existe el grupo «${args.group}». Los que hay: ${groups.map((x) => x.name).join(", ")}`, "grupo desconocido");
      groupId = g.id;
    }
    try {
      await assertCanUpload(org, Buffer.byteLength(args.text) * 2);
    } catch (err) {
      if (err instanceof LimitError) return fail(err.message, "sin espacio");
      throw err;
    }
    const safe = args.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120) || "documento";
    try {
      const doc = await createDocument(org, {
        title: args.title,
        filename: `${safe}.md`,
        mime: "text/markdown",
        byteSize: Buffer.byteLength(args.text),
        text: args.text,
        contentSha256: createHash("sha256").update(args.text).digest("hex"),
        uploadedByUserId: session.userId,
        groupId,
        agentId: args.agent_id ?? null,
      });
      scheduleIndex(org, doc.id);
      void checkStorageAlerts(org);
      return { data: { ok: true, id: doc.id, status: "Procesando" }, summary: `cargó el documento «${doc.title}»` };
    } catch (err) {
      if (err instanceof KbDocError) return fail(err.detail ?? KB_DOC_ERROR_LABEL[err.code], `no se cargó (${err.code})`);
      if (err instanceof KbGroupError) return fail(KB_GROUP_ERROR_LABEL[err.code], `no se cargó (${err.code})`);
      throw err;
    }
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cada herramienta valida sus propios argumentos
export const KNOWLEDGE_TOOLS: readonly ToolSpec<any>[] = [
  listKnowledge,
  addKnowledge,
  updateKnowledge,
  listDocumentsTool,
  readDocumentTool,
  addDocumentTool,
];
