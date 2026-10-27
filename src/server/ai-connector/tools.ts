import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { CLIENT_CONTENT_NOTICE, type Scope } from "@/lib/ai-connector";
import type { SessionContext } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { scoped, scopedConversations } from "@/lib/db/tenant";
import { DEFAULT_FILTERS, MAX_QUERY_LENGTH, type ListStatus } from "@/lib/inbox-list";
import type { ConversationDto } from "@/lib/types";
import { TASK_FILTERS } from "@/lib/work";
import { getContactStage } from "@/server/contacts";
import { decodeCursor } from "@/server/inbox/cursor";
import { getConversation, listConversationsPage } from "@/server/inbox/queries";
import { orgHasModule } from "@/server/modules";
import { listQuickReplies } from "@/server/quick-replies/store";
import { listTags, tagsForContacts } from "@/server/tags/tags";
import { listTasks, viewerOf } from "@/server/work/tasks";

/**
 * 047 — CATÁLOGO CERRADO de herramientas del conector de IA. La IA pide una
 * herramienta por nombre con argumentos validados (Zod); nunca SQL ni rutas.
 * Cada una corre con la sesión de la persona y las consultas del CRM
 * (`scopedContacts()`/`scopedConversations()`), así que ve exactamente lo
 * que la persona ve en la Bandeja: los chats de «Mi número» no salen por
 * aquí (`getConversation` y la lista usan solo los de la empresa).
 *
 * PR 2: solo lectura. Las acciones (enviar, etiquetar…) llegan en el PR 4
 * con el alcance `write`. Nunca habrá exportar, campañas, borrar ni ajustes.
 */

export type ToolContext = { session: SessionContext; scopes: readonly Scope[] };

export type ToolOutcome = {
  data: Record<string, unknown>;
  /** Para «Qué hizo tu IA» (nunca texto de mensajes). */
  summary: string;
  conversationId?: string | null;
  contactId?: string | null;
  /** true = la herramienta respondió «no encontrado» o similar. */
  isError?: boolean;
};

export type ToolSpec<A> = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  parse: z.ZodType<A, z.ZodTypeDef, unknown>;
  scope: Scope;
  /** La herramienta solo existe si la organización tiene el módulo. */
  available?: (organizationId: string) => Promise<boolean>;
  run: (ctx: ToolContext, args: A) => Promise<ToolOutcome>;
};

const MAX_TEXT = 2000;

function clip(text: string | null | undefined, max = MAX_TEXT): string | null {
  if (text == null) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function chatSummary(c: ConversationDto) {
  return {
    conversation_id: c.id,
    contact: { id: c.contact.id, name: c.contact.name, phone: c.contact.phone },
    channel: c.channel,
    assignee: c.assignee?.name ?? null,
    stage: c.stageName,
    tags: c.tags.map((t) => t.name),
    unread: c.unreadCount,
    last_message_at: c.lastMessageAt,
    last_inbound_at: c.lastInboundAt,
    preview: clip(c.preview, 200),
    window_open: c.windowOpen,
    archived: c.archivedAt !== null,
    ai_paused: c.handoffAt !== null,
  };
}

const listChatsArgs = z.object({
  status: z.enum(["all", "unread", "archived", "humano"]).default("all"),
  query: z.string().trim().max(MAX_QUERY_LENGTH).default(""),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().max(500).optional(),
});

const listChats: ToolSpec<z.infer<typeof listChatsArgs>> = {
  name: "list_chats",
  title: "Ver mis chats",
  description:
    "Lista los chats de WhatsApp que la persona puede ver en la Bandeja, del más reciente al más viejo. " +
    "status: all (todos los no archivados), unread (con mensajes sin leer), archived, humano (esperan a una persona). " +
    "query busca por nombre o teléfono del contacto. Devuelve next_cursor para pedir la siguiente página.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["all", "unread", "archived", "humano"], default: "all" },
      query: { type: "string", maxLength: MAX_QUERY_LENGTH, description: "Nombre o teléfono a buscar" },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      cursor: { type: "string", description: "next_cursor de la página anterior" },
    },
    additionalProperties: false,
  },
  parse: listChatsArgs,
  scope: "read",
  run: async ({ session }, args) => {
    const cursor = decodeCursor(args.cursor ?? null);
    if (cursor === "invalid") return { data: { error: "cursor no válido" }, summary: "cursor no válido", isError: true };
    const page = await listConversationsPage(
      session.access,
      "main",
      { ...DEFAULT_FILTERS, q: args.query, status: args.status as ListStatus },
      { limit: args.limit, cursor }
    );
    return {
      data: { chats: page.conversations.map(chatSummary), next_cursor: page.nextCursor },
      summary: `${page.conversations.length} chats (${args.status})`,
    };
  },
};

const readChatArgs = z.object({
  conversation_id: z.string().min(1).max(60),
  limit: z.number().int().min(1).max(100).default(30),
});

const readChat: ToolSpec<z.infer<typeof readChatArgs>> = {
  name: "read_chat",
  title: "Leer un chat",
  description:
    "Lee los últimos mensajes de un chat (del más viejo al más nuevo) con la ficha del contacto: etapa, etiquetas y quién atiende. " +
    "Leerlo no lo marca como leído. window_open dice si se puede contestar con texto libre (ventana de 24 h de WhatsApp).",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: { type: "string", description: "conversation_id de list_chats" },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
    },
    required: ["conversation_id"],
    additionalProperties: false,
  },
  parse: readChatArgs,
  scope: "read",
  run: async ({ session }, args) => {
    const found = await getConversation(session.access, args.conversation_id);
    if (!found) {
      return { data: { error: "No existe o no tienes acceso a ese chat" }, summary: "chat no encontrado", isError: true };
    }
    const { conversation: c, contact } = found;
    const rows = await getDb()
      .select({ message: schema.message, mediaKind: schema.mediaAsset.kind })
      .from(schema.message)
      .leftJoin(schema.mediaAsset, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
      .where(
        scopedConversations(
          schema.message.organizationId,
          session.access,
          schema.message.conversationId,
          eq(schema.message.conversationId, c.id)
        )
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(args.limit);
    const [stage, tags] = await Promise.all([
      getContactStage(session.access, contact.id),
      tagsForContacts(session.organizationId, [contact.id]),
    ]);
    const lastInbound = c.lastInboundAt?.getTime() ?? 0;
    return {
      data: {
        notice: CLIENT_CONTENT_NOTICE,
        conversation_id: c.id,
        contact: { id: contact.id, name: contact.name, phone: contact.phone },
        stage: stage?.stage.name ?? null,
        tags: (tags.get(contact.id) ?? []).map((t) => t.name),
        assigned_to_me: contact.assignedUserId === session.userId,
        window_open: lastInbound > 0 && Date.now() - lastInbound < 24 * 60 * 60 * 1000,
        messages: rows.reverse().map(({ message: m, mediaKind }) => ({
          id: m.id,
          from: m.direction === "in" ? "cliente" : m.origin === "ai" || m.aiGenerated ? "ia" : "equipo",
          type: m.type,
          text: clip(m.text),
          attachment: mediaKind ?? null,
          at: (m.waTimestamp ?? m.createdAt).toISOString(),
          status: m.direction === "out" ? m.status : undefined,
        })),
      },
      summary: `leyó ${rows.length} mensajes`,
      conversationId: c.id,
      contactId: contact.id,
    };
  },
};

const empty = z.object({}).strict();
const emptySchema = { type: "object", properties: {}, additionalProperties: false };

const listStages: ToolSpec<z.infer<typeof empty>> = {
  name: "list_stages",
  title: "Ver etapas del pipeline",
  description: "Las etapas del pipeline de ventas en orden, con su tipo: open (abierta), won (ganada) o lost (perdida).",
  inputSchema: emptySchema,
  parse: empty,
  scope: "read",
  run: async ({ session }) => {
    const stages = await getDb()
      .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name, kind: schema.pipelineStage.kind })
      .from(schema.pipelineStage)
      .where(scoped(schema.pipelineStage.organizationId, session.organizationId))
      .orderBy(asc(schema.pipelineStage.position));
    return { data: { stages }, summary: `${stages.length} etapas` };
  },
};

const listTagsTool: ToolSpec<z.infer<typeof empty>> = {
  name: "list_tags",
  title: "Ver etiquetas",
  description: "Las etiquetas de contacto que existen en la organización.",
  inputSchema: emptySchema,
  parse: empty,
  scope: "read",
  run: async ({ session }) => {
    const tags = await listTags(session.organizationId);
    return { data: { tags: tags.map((t) => t.name) }, summary: `${tags.length} etiquetas` };
  },
};

const listQuickRepliesTool: ToolSpec<z.infer<typeof empty>> = {
  name: "list_quick_replies",
  title: "Ver respuestas rápidas",
  description:
    "Las respuestas rápidas que guardó el equipo (atajo y texto). {nombre} se cambia por el primer nombre del contacto.",
  inputSchema: emptySchema,
  parse: empty,
  scope: "read",
  run: async ({ session }) => {
    const replies = await listQuickReplies(session.organizationId);
    return {
      data: { quick_replies: replies.map((r) => ({ shortcut: r.shortcut, text: clip(r.body) })) },
      summary: `${replies.length} respuestas rápidas`,
    };
  },
};

const listTasksArgs = z.object({ filter: z.enum(TASK_FILTERS).default("mine") });

const listTasksTool: ToolSpec<z.infer<typeof listTasksArgs>> = {
  name: "list_tasks",
  title: "Ver tareas",
  description:
    "Las tareas de la persona. filter: mine (mis pendientes), overdue (vencidas), done (hechas), all (todas las que puede ver).",
  inputSchema: {
    type: "object",
    properties: { filter: { type: "string", enum: [...TASK_FILTERS], default: "mine" } },
    additionalProperties: false,
  },
  parse: listTasksArgs,
  scope: "read",
  available: (org) => orgHasModule(org, "trabajo"),
  run: async ({ session }, args) => {
    const tasks = await listTasks(viewerOf(session), { filter: args.filter });
    return {
      data: {
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: clip(t.description, 500),
          due_at: t.dueAt,
          done_at: t.doneAt,
          assignee: t.assignee?.name ?? null,
          contact: t.contact,
          conversation_id: t.conversationId,
        })),
      },
      summary: `${tasks.length} tareas (${args.filter})`,
    };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cada herramienta valida sus propios argumentos
export const TOOLS: readonly ToolSpec<any>[] = [listChats, readChat, listStages, listTagsTool, listQuickRepliesTool, listTasksTool];

/** Las herramientas que ESTA conexión puede usar hoy (alcance y módulos). */
export async function toolsFor(organizationId: string, scopes: readonly Scope[]) {
  const out = [];
  for (const t of TOOLS) {
    if (!scopes.includes(t.scope)) continue;
    if (t.available && !(await t.available(organizationId))) continue;
    out.push(t);
  }
  return out;
}

/** La forma de `tools/list` de MCP. */
export function describeTool(t: ToolSpec<unknown>) {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: t.scope === "read", destructiveHint: false, openWorldHint: false },
  };
}
