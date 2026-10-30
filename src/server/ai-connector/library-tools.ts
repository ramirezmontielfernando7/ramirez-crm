import { z } from "zod";
import type { SessionContext } from "@/lib/auth/session";
import { GENERAL_GROUP_NAME, KB_DOC_ERROR_LABEL, KB_GROUP_ERROR_LABEL, normalizeGroupName } from "@/lib/kb-docs";
import { KNOWLEDGE_BODY_MAX, KNOWLEDGE_TAGS_MAX, KNOWLEDGE_TITLE_MAX, parseTags } from "@/lib/knowledge";
import type { ToolOutcome, ToolSpec } from "@/server/ai-connector/tools";
import { orgHasKbDocs } from "@/server/kb-docs/flag";
import { createGroup, KbDocError, KbGroupError, listGroups, moveDocument, renameGroup } from "@/server/kb-docs/store";
import { createKnowledge, getKnowledge, listKnowledge, updateKnowledge } from "@/server/knowledge/store";
import {
  disableRagForEntry,
  enableRagForEntry,
  LibraryError,
  libraryAccess,
  refreshRagForEntry,
  setEntryInChat,
} from "@/server/library/bridge";
import { withRag } from "@/server/library/view";
import { LimitError } from "@/server/limits";
import { orgHasModule } from "@/server/modules";
import { MediaValidationError } from "@/server/whatsapp/media";
import { UPLOAD_LINK_MAX_FILES, UPLOAD_LINK_NOTE_MAX } from "@/lib/ai-connector";
import { createUploadLink, getUploadLink, stateOf } from "@/server/ai-connector/upload-links";

/**
 * 047 — La Biblioteca para la IA conectada: lo que la pantalla deja hacer con
 * una entrada (título, texto, etiquetas, «💬 Envío en chat» y «🤖 Lectura IA»)
 * y con los grupos de documentos (crear, renombrar, mover un documento). Por
 * las mismas puertas (`knowledge/store.ts`, `library/bridge.ts`,
 * `kb-docs/store.ts`) y los mismos permisos: `knowledge.manage` para la
 * Biblioteca; encender la lectura de la IA y los grupos piden además lo de la
 * pantalla (`libraryAccess(...).rag` / `agent.manage`). Todas viven en
 * «Ajustar agentes de IA» (`area: "agents"`). Nada borra: quitar una entrada
 * o un grupo sigue siendo de una persona en la pantalla.
 *
 * Archivos: la IA no puede mandar los bytes de un PDF. Pide un enlace de
 * subida de un solo uso (`create_upload_link`) y la persona sube ahí los
 * originales con su sesión; `check_upload_link` dice qué subió.
 */

function fail(error: string, summary: string): ToolOutcome {
  return { data: { error }, summary, isError: true };
}

/** Los errores de las puertas, en palabras de la pantalla. */
function libraryFailure(err: unknown, what: string): ToolOutcome | null {
  if (err instanceof LibraryError) return fail(err.message, `${what} (${err.code})`);
  if (err instanceof LimitError) return fail(err.message, `${what} (tope)`);
  if (err instanceof MediaValidationError) return fail(err.message, `${what} (archivo)`);
  if (err instanceof KbDocError) return fail(err.detail ?? KB_DOC_ERROR_LABEL[err.code], `${what} (${err.code})`);
  if (err instanceof KbGroupError) return fail(KB_GROUP_ERROR_LABEL[err.code], `${what} (${err.code})`);
  return null;
}

const libraryOn = (org: string) => orgHasModule(org, "knowledge");

/** El grupo por nombre; «General» (o nada) = null. `undefined` = no existe. */
async function groupByName(organizationId: string, name: string | undefined): Promise<{ id: string | null } | { missing: string[] }> {
  if (!name || name.toLocaleLowerCase("es") === GENERAL_GROUP_NAME.toLocaleLowerCase("es")) return { id: null };
  const groups = await listGroups(organizationId);
  const g = groups.find((x) => x.id && x.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"));
  return g?.id ? { id: g.id } : { missing: groups.map((x) => x.name) };
}

async function ragAllowed(session: SessionContext) {
  return (await libraryAccess(session)).rag;
}

const tagsSchema = z.array(z.string().trim().min(1).max(60)).max(KNOWLEDGE_TAGS_MAX);

/* ============================== Biblioteca ============================== */

const listArgs = z.object({ query: z.string().trim().max(120).default(""), tag: z.string().trim().max(60).optional() });

const listLibrary: ToolSpec<z.infer<typeof listArgs>> = {
  name: "list_library",
  title: "Ver la Biblioteca",
  description:
    "Todo lo de la Biblioteca (lo que el equipo manda en el chat y lo que solo lee la IA): título, etiquetas, archivo, " +
    "si aparece en la Bandeja (in_chat) y si la IA lo lee (rag, con su grupo). Filtra con query o tag.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", maxLength: 120 }, tag: { type: "string" } },
    additionalProperties: false,
  },
  parse: listArgs,
  scope: "read",
  permission: "knowledge.manage",
  area: "agents",
  available: libraryOn,
  run: async ({ session }, args) => {
    const org = session.organizationId;
    const rows = await listKnowledge(org, { q: args.query, tag: args.tag, chatOnly: false });
    const [entries, groups] = await Promise.all([withRag(org, rows), (await orgHasKbDocs(org)) ? listGroups(org) : []]);
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const all = rows.map((r) => r.tags).flat();
    return {
      data: {
        tags: [...new Set(all)].sort(),
        groups: groups.map((g) => g.name),
        entries: entries.map((e) => ({
          id: e.id,
          title: e.title,
          tags: e.tags,
          text: e.body.length > 500 ? `${e.body.slice(0, 500)}…` : e.body,
          file: e.file ? { name: e.file.name, mime: e.file.mime } : null,
          in_chat: e.showInChat,
          rag: e.rag ? { document_id: e.rag.documentId, status: e.rag.status, group: groupName.get(e.rag.groupId) ?? GENERAL_GROUP_NAME } : null,
        })),
      },
      summary: `${entries.length} entradas`,
    };
  },
};

const addArgs = z
  .object({
    title: z.string().trim().min(1).max(KNOWLEDGE_TITLE_MAX),
    text: z.string().trim().min(1).max(KNOWLEDGE_BODY_MAX),
    tags: tagsSchema.default([]),
    in_chat: z.boolean().default(true),
    rag: z.boolean().default(false),
    rag_group: z.string().trim().min(1).max(60).optional(),
  })
  .refine((a) => a.in_chat || a.rag, "Al menos un destino: in_chat o rag");

const addToLibrary: ToolSpec<z.infer<typeof addArgs>> = {
  name: "add_to_library",
  title: "Agregar a la Biblioteca",
  description:
    "Crea una entrada de la Biblioteca con título, texto y etiquetas (p. ej. [\"Planes\", \"UG\"]; una etiqueta nueva se crea al usarla). " +
    "in_chat: aparece en la Bandeja para enviarla (por defecto sí). rag: la IA del CRM también la lee, en el grupo rag_group " +
    "(nombre de list_documents; sin él, General). Es texto: para subir el archivo original (PDF, Word), usa create_upload_link.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: KNOWLEDGE_TITLE_MAX },
      text: { type: "string", maxLength: KNOWLEDGE_BODY_MAX },
      tags: { type: "array", items: { type: "string" }, maxItems: KNOWLEDGE_TAGS_MAX },
      in_chat: { type: "boolean", default: true },
      rag: { type: "boolean", default: false },
      rag_group: { type: "string" },
    },
    required: ["title", "text"],
    additionalProperties: false,
  },
  parse: addArgs,
  scope: "write",
  permission: "knowledge.manage",
  area: "agents",
  serial: true,
  available: libraryOn,
  run: async ({ session }, args) => {
    const org = session.organizationId;
    if (args.rag && !(await ragAllowed(session))) return fail("No puedes entrenar a la IA del CRM desde aquí", "sin lectura IA");
    let groupId: string | null = null;
    if (args.rag) {
      const g = await groupByName(org, args.rag_group);
      if ("missing" in g) return fail(`No existe el grupo «${args.rag_group}». Los que hay: ${g.missing.join(", ")}`, "grupo desconocido");
      groupId = g.id;
    }
    const row = await createKnowledge({
      organizationId: org,
      userId: session.userId,
      title: args.title,
      body: args.text,
      tags: parseTags(args.tags),
      file: null,
      showInChat: args.in_chat,
    });
    let ragError: string | null = null;
    if (args.rag) {
      try {
        await enableRagForEntry({ organizationId: org, userId: session.userId, entry: row, groupId });
      } catch (err) {
        const f = libraryFailure(err, "sin lectura IA");
        if (!f) throw err;
        ragError = String(f.data.error);
        // Sin «Lectura IA» y sin Bandeja quedaría sin destino: se muestra en la Bandeja.
        if (!args.in_chat) await setEntryInChat(org, row, true);
      }
    }
    return {
      data: { ok: true, id: row.id, ...(ragError ? { rag_error: ragError, in_chat: true } : {}) },
      summary: `agregó «${row.title}» a la Biblioteca`,
    };
  },
};

const updateArgs = z
  .object({
    entry_id: z.string().min(1).max(60),
    title: z.string().trim().min(1).max(KNOWLEDGE_TITLE_MAX).optional(),
    text: z.string().trim().min(1).max(KNOWLEDGE_BODY_MAX).optional(),
    tags: tagsSchema.optional(),
    add_tags: tagsSchema.optional(),
    remove_tags: tagsSchema.optional(),
    in_chat: z.boolean().optional(),
    rag: z.boolean().optional(),
    rag_group: z.string().trim().min(1).max(60).optional(),
  })
  .refine((a) => Object.keys(a).length > 1, "Nada que cambiar")
  .refine((a) => !(a.in_chat === false && a.rag === false), "Al menos un destino: in_chat o rag");

const updateLibraryEntry: ToolSpec<z.infer<typeof updateArgs>> = {
  name: "update_library_entry",
  title: "Editar una entrada de la Biblioteca",
  description:
    "Cambia una entrada (entry_id de list_library): título, texto, etiquetas (tags reemplaza todas; add_tags/remove_tags " +
    "agregan o quitan), si aparece en la Bandeja (in_chat) y si la IA del CRM la lee (rag, en rag_group). Siempre queda al menos un destino.",
  inputSchema: {
    type: "object",
    properties: {
      entry_id: { type: "string" },
      title: { type: "string", maxLength: KNOWLEDGE_TITLE_MAX },
      text: { type: "string", maxLength: KNOWLEDGE_BODY_MAX },
      tags: { type: "array", items: { type: "string" } },
      add_tags: { type: "array", items: { type: "string" } },
      remove_tags: { type: "array", items: { type: "string" } },
      in_chat: { type: "boolean" },
      rag: { type: "boolean" },
      rag_group: { type: "string" },
    },
    required: ["entry_id"],
    additionalProperties: false,
  },
  parse: updateArgs,
  scope: "write",
  permission: "knowledge.manage",
  area: "agents",
  serial: true,
  available: libraryOn,
  run: async ({ session }, args) => {
    const org = session.organizationId;
    let entry = await getKnowledge(org, args.entry_id);
    if (!entry) return fail("No existe esa entrada", "entrada no encontrada");
    if (args.rag !== undefined && !(await ragAllowed(session))) {
      return fail("No puedes entrenar a la IA del CRM desde aquí", "sin lectura IA");
    }
    let tags: string[] | undefined;
    if (args.tags || args.add_tags || args.remove_tags) {
      const drop = new Set((args.remove_tags ?? []).map((t) => t.toLocaleLowerCase("es")));
      const base = args.tags ?? entry.tags;
      tags = parseTags([...base, ...(args.add_tags ?? [])].filter((t) => !drop.has(t.toLocaleLowerCase("es"))));
    }
    try {
      if (args.title !== undefined || args.text !== undefined || tags !== undefined) {
        const row = await updateKnowledge(org, entry.id, {
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.text !== undefined ? { body: args.text } : {}),
          ...(tags !== undefined ? { tags } : {}),
        });
        if (!row) return fail("No existe esa entrada", "entrada no encontrada");
        entry = row;
        // Si la IA la lee y cambió el texto, su documento se rehace (como en la pantalla).
        if (args.text !== undefined) await refreshRagForEntry(org, session.userId, entry);
      }
      // Primero lo que enciende: así apagar el otro no choca con «un destino al menos».
      if (args.rag === true) {
        const g = await groupByName(org, args.rag_group);
        if ("missing" in g) return fail(`No existe el grupo «${args.rag_group}». Los que hay: ${g.missing.join(", ")}`, "grupo desconocido");
        await enableRagForEntry({ organizationId: org, userId: session.userId, entry, groupId: g.id });
      }
      if (args.in_chat !== undefined) entry = await setEntryInChat(org, entry, args.in_chat);
      if (args.rag === false) await disableRagForEntry(org, entry);
    } catch (err) {
      const f = libraryFailure(err, "no se editó");
      if (f) return f;
      throw err;
    }
    return { data: { ok: true, tags: entry.tags, in_chat: entry.showInChat }, summary: `editó «${entry.title}» de la Biblioteca` };
  },
};

/* ============================== Grupos de documentos ============================== */

const docsOn = (org: string) => orgHasKbDocs(org);

const createGroupArgs = z.object({ name: z.string().trim().min(1).max(60) });

const createDocumentGroup: ToolSpec<z.infer<typeof createGroupArgs>> = {
  name: "create_document_group",
  title: "Crear un grupo de documentos",
  description: "Crea un grupo de documentos de la IA del CRM (como «Planes de estudio»). «General» ya existe y no se crea.",
  inputSchema: { type: "object", properties: { name: { type: "string", maxLength: 60 } }, required: ["name"], additionalProperties: false },
  parse: createGroupArgs,
  scope: "write",
  permission: "agent.manage",
  area: "agents",
  available: docsOn,
  run: async ({ session }, args) => {
    const name = normalizeGroupName(args.name);
    if (!name.ok) return fail(KB_GROUP_ERROR_LABEL[name.code], `grupo no válido (${name.code})`);
    try {
      const g = await createGroup(session.organizationId, name.name);
      return { data: { ok: true, id: g.id, name: g.name }, summary: `creó el grupo «${g.name}»` };
    } catch (err) {
      const f = libraryFailure(err, "grupo no creado");
      if (f) return f;
      throw err;
    }
  },
};

const renameGroupArgs = z.object({ group: z.string().trim().min(1).max(60), name: z.string().trim().min(1).max(60) });

const renameDocumentGroup: ToolSpec<z.infer<typeof renameGroupArgs>> = {
  name: "rename_document_group",
  title: "Renombrar un grupo de documentos",
  description: "Cambia el nombre de un grupo de documentos (group = su nombre actual). «General» no se renombra.",
  inputSchema: {
    type: "object",
    properties: { group: { type: "string" }, name: { type: "string", maxLength: 60 } },
    required: ["group", "name"],
    additionalProperties: false,
  },
  parse: renameGroupArgs,
  scope: "write",
  permission: "agent.manage",
  area: "agents",
  available: docsOn,
  run: async ({ session }, args) => {
    const g = await groupByName(session.organizationId, args.group);
    if ("missing" in g) return fail(`No existe el grupo «${args.group}». Los que hay: ${g.missing.join(", ")}`, "grupo desconocido");
    if (g.id === null) return fail("«General» no se renombra", "grupo General");
    const name = normalizeGroupName(args.name);
    if (!name.ok) return fail(KB_GROUP_ERROR_LABEL[name.code], `grupo no válido (${name.code})`);
    try {
      const row = await renameGroup(session.organizationId, g.id, name.name);
      return { data: { ok: true, name: row.name }, summary: `renombró un grupo a «${row.name}»` };
    } catch (err) {
      const f = libraryFailure(err, "grupo no renombrado");
      if (f) return f;
      throw err;
    }
  },
};

const moveArgs = z.object({ document_id: z.string().min(1).max(60), group: z.string().trim().min(1).max(60) });

const moveDocumentTool: ToolSpec<z.infer<typeof moveArgs>> = {
  name: "move_document",
  title: "Mover un documento de grupo",
  description: "Pasa un documento de la IA del CRM (document_id de list_documents) a otro grupo, por nombre («General» incluido).",
  inputSchema: {
    type: "object",
    properties: { document_id: { type: "string" }, group: { type: "string" } },
    required: ["document_id", "group"],
    additionalProperties: false,
  },
  parse: moveArgs,
  scope: "write",
  permission: "agent.manage",
  area: "agents",
  available: docsOn,
  run: async ({ session }, args) => {
    const g = await groupByName(session.organizationId, args.group);
    if ("missing" in g) return fail(`No existe el grupo «${args.group}». Los que hay: ${g.missing.join(", ")}`, "grupo desconocido");
    try {
      const doc = await moveDocument(session.organizationId, args.document_id, g.id);
      if (!doc) return fail("No existe ese documento", "documento no encontrado");
      return { data: { ok: true }, summary: `movió «${doc.title}» a ${args.group}` };
    } catch (err) {
      const f = libraryFailure(err, "no se movió");
      if (f) return f;
      throw err;
    }
  },
};

/* ============================== Enlace de subida ============================== */

const linkArgs = z
  .object({
    note: z.string().trim().max(UPLOAD_LINK_NOTE_MAX).optional(),
    tags: tagsSchema.default([]),
    in_chat: z.boolean().default(true),
    rag: z.boolean().default(false),
    rag_group: z.string().trim().min(1).max(60).optional(),
  })
  .refine((a) => a.in_chat || a.rag, "Al menos un destino: in_chat o rag");

const createUploadLinkTool: ToolSpec<z.infer<typeof linkArgs>> = {
  name: "create_upload_link",
  title: "Pedir archivos con un enlace de subida",
  description:
    "Para subir archivos (PDF, Word, texto, imagen) a la Biblioteca: crea un enlace de un solo uso que la persona abre con su sesión " +
    `del CRM y ahí sube hasta ${UPLOAD_LINK_MAX_FILES} archivos (dura un día). Dale el enlace tal cual. note: lo que verá arriba (p. ej. ` +
    "«Sube los PDF de las carreras»). tags, in_chat y rag (en rag_group) se aplican a cada archivo. Después, check_upload_link dice qué subió.",
  inputSchema: {
    type: "object",
    properties: {
      note: { type: "string", maxLength: UPLOAD_LINK_NOTE_MAX },
      tags: { type: "array", items: { type: "string" }, maxItems: KNOWLEDGE_TAGS_MAX },
      in_chat: { type: "boolean", default: true },
      rag: { type: "boolean", default: false },
      rag_group: { type: "string" },
    },
    additionalProperties: false,
  },
  parse: linkArgs,
  scope: "write",
  permission: "knowledge.manage",
  area: "agents",
  serial: true,
  available: libraryOn,
  run: async ({ session, connectionId }, args) => {
    const org = session.organizationId;
    if (args.rag && !(await ragAllowed(session))) return fail("No puedes entrenar a la IA del CRM desde aquí", "sin lectura IA");
    let groupId: string | null = null;
    if (args.rag) {
      const g = await groupByName(org, args.rag_group);
      if ("missing" in g) return fail(`No existe el grupo «${args.rag_group}». Los que hay: ${g.missing.join(", ")}`, "grupo desconocido");
      groupId = g.id;
    }
    const link = await createUploadLink({
      organizationId: org,
      userId: session.userId,
      connectionId,
      note: args.note || null,
      tags: parseTags(args.tags),
      inChat: args.in_chat,
      rag: args.rag,
      ragGroupId: groupId,
    });
    return {
      data: {
        ok: true,
        link_id: link.id,
        url: link.url,
        expires_at: link.expiresAt.toISOString(),
        max_files: UPLOAD_LINK_MAX_FILES,
        instructions: "Comparte el enlace con la persona; solo ella lo abre, con su sesión del CRM.",
      },
      summary: "creó un enlace para subir archivos",
    };
  },
};

const checkLinkArgs = z.object({ link_id: z.string().min(1).max(60) });

const checkUploadLinkTool: ToolSpec<z.infer<typeof checkLinkArgs>> = {
  name: "check_upload_link",
  title: "Ver lo que se subió por un enlace",
  description:
    "Qué archivos subió la persona por un enlace de create_upload_link (link_id): estado del enlace (open, closed, expired, full) " +
    "y cada entrada de la Biblioteca con su id, título, archivo y destinos. Para editarlas usa update_library_entry.",
  inputSchema: {
    type: "object",
    properties: { link_id: { type: "string" } },
    required: ["link_id"],
    additionalProperties: false,
  },
  parse: checkLinkArgs,
  scope: "read",
  permission: "knowledge.manage",
  area: "agents",
  available: libraryOn,
  run: async ({ session }, args) => {
    const org = session.organizationId;
    const link = await getUploadLink(org, session.userId, args.link_id);
    if (!link) return fail("No existe ese enlace (o no es tuyo)", "enlace desconocido");
    const rows = (await Promise.all(link.entryIds.map((id) => getKnowledge(org, id)))).filter(
      (r): r is NonNullable<typeof r> => r !== null
    );
    const entries = await withRag(org, rows);
    return {
      data: {
        state: stateOf(link),
        expires_at: link.expiresAt.toISOString(),
        files: entries.map((e) => ({
          id: e.id,
          title: e.title,
          file: e.file?.name ?? null,
          tags: e.tags,
          in_chat: e.showInChat,
          rag: e.rag ? { document_id: e.rag.documentId, status: e.rag.status } : null,
        })),
      },
      summary: `${entries.length} archivos subidos por el enlace`,
    };
  },
};

export const LIBRARY_TOOLS = [
  listLibrary,
  addToLibrary,
  updateLibraryEntry,
  createDocumentGroup,
  renameDocumentGroup,
  moveDocumentTool,
  createUploadLinkTool,
  checkUploadLinkTool,
];

