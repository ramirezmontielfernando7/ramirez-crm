import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { advancedAllows, CLIENT_CONTENT_NOTICE, type AdvancedArea, type Scope } from "@/lib/ai-connector";
import { can, type Permission } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { scoped, scopedConversations } from "@/lib/db/tenant";
import { DEFAULT_FILTERS, MAX_QUERY_LENGTH, type ListStatus } from "@/lib/inbox-list";
import type { ConversationDto } from "@/lib/types";
import { TASK_DESCRIPTION_MAX, TASK_FILTERS, TASK_TITLE_MAX } from "@/lib/work";
import { logActivity } from "@/server/activity/log";
import { ADVANCED_TOOLS } from "@/server/ai-connector/advanced-tools";
import { CHAT_TOOLS } from "@/server/ai-connector/chat-tools";
import { CRM_TOOLS } from "@/server/ai-connector/crm-tools";
import { EXTRA_TOOLS } from "@/server/ai-connector/extra-tools";
import { KNOWLEDGE_TOOLS } from "@/server/ai-connector/knowledge-tools";
import { LIBRARY_TOOLS } from "@/server/ai-connector/library-tools";
import { getConnectorSettings } from "@/server/ai-connector/settings";
import { messagesSentLastDay } from "@/server/ai-connector/log";
import {
  aiNumberChat,
  aiNumberMessages,
  aiNumberOf,
  listAiNumberChats,
  sendAsMyNumberAi,
  type AiNumberChat,
} from "@/server/ai-connector/my-number";
import { assignContacts, listAssignees } from "@/server/assignment/assign";
import { getContactStage } from "@/server/contacts";
import { publish } from "@/server/events/bus";
import { decodeCursor } from "@/server/inbox/cursor";
import { getConversation, listConversationsPage } from "@/server/inbox/queries";
import { SendError, sendText } from "@/server/inbox/send";
import { listLossReasons } from "@/server/leads/loss-reasons";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { orgHasModule } from "@/server/modules";
import { listQuickReplies } from "@/server/quick-replies/store";
import { listTags, setContactTags, tagsForContacts } from "@/server/tags/tags";
import { createTask, listTasks, TaskInputError, viewerOf } from "@/server/work/tasks";

/**
 * 047 — CATÁLOGO CERRADO de herramientas del conector de IA. La IA pide una
 * herramienta por nombre con argumentos validados (Zod); nunca SQL ni rutas.
 * Cada una corre con la sesión de la persona y las consultas del CRM
 * (`scopedContacts()`/`scopedConversations()`), así que ve exactamente lo
 * que la persona ve en la Bandeja: los chats de «Mi número» no salen por
 * aquí (`getConversation` y la lista usan solo los de la empresa). PR 4b:
 * salvo los chats de cliente del número PROPIO con el quinto interruptor
 * encendido (`my-number.ts`): `list_chats` con `inbox: "mi_numero"`, y
 * `read_chat`/`send_message` los aceptan. Nada más (etiquetas, etapas,
 * notas…) los toca.
 *
 * PR 2: lectura. PR 4: las acciones con el alcance `write` (enviar,
 * etiquetar, mover de etapa, notas, tareas, asignar), cada una por la MISMA
 * puerta que usa la pantalla. PR 6: las «Funciones avanzadas» viven en
 * `advanced-tools.ts` (exportar/importar, campañas, etiquetas, agentes y
 * algunos ajustes), cada una con su `area`. Nunca habrá borrar, conexión de
 * WhatsApp, roles, equipo ni llaves.
 */

export type ToolContext = {
  session: SessionContext;
  scopes: readonly Scope[];
  connectionId: string;
  /** Cómo firma esta IA en la Bandeja («Joe»); null = «Asistente». */
  assistantName: string | null;
};

export type ToolOutcome = {
  data: Record<string, unknown>;
  /** Para «Qué hizo tu IA» (nunca texto de mensajes). */
  summary: string;
  conversationId?: string | null;
  contactId?: string | null;
  /** true = la herramienta respondió «no encontrado» o similar. */
  isError?: boolean;
  /** Para la bitácora: `limited` = tope diario; `denied` = no le toca. */
  outcome?: "limited" | "denied";
};

export type ToolSpec<A> = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  parse: z.ZodType<A, z.ZodTypeDef, unknown>;
  scope: Scope;
  /** La herramienta solo existe para quien tiene este permiso (la misma matriz del CRM). */
  permission?: Permission;
  /**
   * Una a la vez por persona (enviar): el tope diario se cuenta con lo ya
   * anotado, así que dos envíos simultáneos no pueden pasarse del tope.
   */
  serial?: boolean;
  /** La herramienta solo existe si la organización tiene el módulo. */
  available?: (organizationId: string) => Promise<boolean>;
  /** PR 6: función avanzada; solo existe si el Propietario abrió esta área a este rol. */
  area?: AdvancedArea;
  /** PR 6: además, «Puede lanzar campañas» encendido. */
  launch?: boolean;
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

/** Para «Qué hizo tu IA»: el filtro en palabras de la pantalla. */
const STATUS_WORD = { all: "todos", unread: "sin leer", archived: "archivados", humano: "esperan a una persona" } as const;

const listChatsArgs = z.object({
  inbox: z.enum(["empresa", "mi_numero"]).default("empresa"),
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
    "query busca por nombre o teléfono del contacto. Devuelve next_cursor para pedir la siguiente página. " +
    "inbox: empresa (la Bandeja, por defecto) o mi_numero (los chats de cliente del WhatsApp propio de la persona, " +
    "solo si ella lo permitió en «Mi número»).",
  inputSchema: {
    type: "object",
    properties: {
      inbox: { type: "string", enum: ["empresa", "mi_numero"], default: "empresa" },
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
    if (args.inbox === "mi_numero") return listNumberChats(session, args);
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
      summary: `${page.conversations.length} chats (${STATUS_WORD[args.status]})`,
    };
  },
};

const NUMBER_OFF: ToolOutcome = {
  data: {
    error:
      "Tu IA no puede ver chats de tu número. Para permitirlo, enciende «Mi IA puede ver y contestar mis chats de cliente» en Ajustes → Mi número.",
  },
  summary: "mi número apagado para la IA",
  isError: true,
  outcome: "denied",
};

function numberChatSummary({ conversation: c, contact, preview }: AiNumberChat) {
  return {
    conversation_id: c.id,
    inbox: "mi_numero",
    contact: { id: contact.id, name: contact.name, phone: contact.phone },
    unread: c.unreadCount,
    last_message_at: c.lastMessageAt?.toISOString() ?? null,
    last_inbound_at: c.lastInboundAt?.toISOString() ?? null,
    preview: clip(preview, 200),
    // Por el número de la persona no hay ventana de 24 h.
    window_open: true,
    archived: c.archivedAt !== null,
  };
}

async function listNumberChats(session: SessionContext, args: z.infer<typeof listChatsArgs>): Promise<ToolOutcome> {
  const number = await aiNumberOf(session);
  if (!number) return NUMBER_OFF;
  if (args.cursor) return { data: { error: "cursor no válido" }, summary: "cursor no válido", isError: true };
  const chats = await listAiNumberChats(session, number, {
    query: args.query,
    limit: args.limit,
    archived: args.status === "archived",
    unread: args.status === "unread",
  });
  return {
    data: { chats: chats.map(numberChatSummary), next_cursor: null },
    summary: `${chats.length} chats de mi número (${STATUS_WORD[args.status]})`,
  };
}

function messageView({ message: m, mediaKind }: { message: typeof schema.message.$inferSelect; mediaKind: string | null }) {
  return {
    id: m.id,
    from: m.direction === "in" ? "cliente" : m.origin === "ai" || m.aiGenerated ? "ia" : "equipo",
    type: m.type,
    text: clip(m.text),
    attachment: mediaKind ?? null,
    at: (m.waTimestamp ?? m.createdAt).toISOString(),
    status: m.direction === "out" ? m.status : undefined,
  };
}

async function readNumberChat(session: SessionContext, conversationId: string, limit: number): Promise<ToolOutcome | null> {
  const chat = await aiNumberChat(session, conversationId);
  if (!chat) return null;
  const rows = await aiNumberMessages(session, chat.conversation.id, limit);
  return {
    data: {
      notice: CLIENT_CONTENT_NOTICE,
      ...numberChatSummary(chat),
      messages: rows.map(messageView),
    },
    summary: `leyó ${rows.length} mensajes de mi número`,
    conversationId: chat.conversation.id,
    contactId: chat.contact.id,
  };
}

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
      const fromNumber = await readNumberChat(session, args.conversation_id, args.limit);
      if (fromNumber) return fromNumber;
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
        messages: rows.reverse().map(messageView),
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

const listPeople: ToolSpec<z.infer<typeof empty>> = {
  name: "list_people",
  title: "Ver el equipo",
  description: "Las personas del equipo a quienes se les puede asignar un chat o una tarea (nombre y rol).",
  inputSchema: emptySchema,
  parse: empty,
  scope: "read",
  permission: "assignment.manage",
  run: async ({ session }) => {
    const people = await listAssignees(session.organizationId);
    return { data: { people: people.map((p) => ({ name: p.name, role: p.role })) }, summary: `${people.length} personas` };
  },
};

/* ------------------------------------------------------------------ *
 * Acciones (alcance `write`). Todas empiezan por `getConversation`: un
 * chat que la persona no ve no existe para su IA.
 * ------------------------------------------------------------------ */

const NOT_FOUND: ToolOutcome = {
  data: { error: "No existe o no tienes acceso a ese chat" },
  summary: "chat no encontrado",
  isError: true,
};

function fail(error: string, summary: string, extra: Partial<ToolOutcome> = {}): ToolOutcome {
  return { data: { error }, summary, isError: true, ...extra };
}

/** Avisa a quien tenga el chat abierto (panel, lista) que algo cambió. */
function touched(organizationId: string, conversationId: string) {
  publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversationId } } });
}

const sendMessageArgs = z.object({
  conversation_id: z.string().min(1).max(60),
  text: z.string().trim().min(1).max(4096),
});

const sendMessage: ToolSpec<z.infer<typeof sendMessageArgs>> = {
  name: "send_message",
  title: "Enviar un mensaje",
  description:
    "Envía un WhatsApp de texto al cliente de un chat, como la persona y por la misma vía que usa la Bandeja: " +
    "si el chat está en Conexión directa o híbrida, sale por el dispositivo vinculado aunque la ventana de 24 h " +
    "esté cerrada (con sus límites y, si toca, en fila). Si el chat solo sale por Meta, necesita la ventana " +
    "abierta (window_open de read_chat). Hay un tope diario de mensajes por persona. Lee el chat antes de contestar. " +
    "En un chat de mi_numero sale por el WhatsApp propio de la persona.",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: { type: "string" },
      text: { type: "string", minLength: 1, maxLength: 4096 },
    },
    required: ["conversation_id", "text"],
    additionalProperties: false,
  },
  parse: sendMessageArgs,
  scope: "write",
  serial: true,
  run: async ({ session, connectionId, assistantName }, args) => {
    const found = await getConversation(session.access, args.conversation_id);
    const numberChat = found ? null : await aiNumberChat(session, args.conversation_id);
    if (!found && !numberChat) return NOT_FOUND;
    const ids = found
      ? { conversationId: found.conversation.id, contactId: found.contact.id }
      : { conversationId: numberChat!.conversation.id, contactId: numberChat!.contact.id };
    const { dailyMessageLimit } = await getConnectorSettings(session.organizationId);
    if (dailyMessageLimit === 0) {
      return fail("En esta empresa la IA conectada solo puede leer: no envía mensajes", "envío apagado", {
        ...ids,
        outcome: "denied",
      });
    }
    const sent = await messagesSentLastDay(session.organizationId, session.userId);
    if (sent >= dailyMessageLimit) {
      return fail(
        `Llegaste al tope de ${dailyMessageLimit} mensajes en 24 horas para tu IA. Escríbelos desde la Bandeja o espera.`,
        `tope diario (${dailyMessageLimit})`,
        { ...ids, outcome: "limited" }
      );
    }
    if (numberChat) {
      const res = await sendAsMyNumberAi(session, numberChat.conversation.id, args.text, {
        aiConnectionId: connectionId,
        aiSenderName: assistantName,
      });
      if (!res) return NOT_FOUND;
      if (!res.ok) return fail(res.message, `no se envió (${res.code})`, ids);
      return {
        data: {
          ok: true,
          message_id: res.messageId,
          queued_until: res.queuedUntil?.toISOString() ?? null,
          sent_today: sent + 1,
          daily_limit: dailyMessageLimit,
        },
        summary: `envió ${args.text.length} caracteres por mi número`,
        ...ids,
      };
    }
    try {
      const res = await sendText({
        conversationId: found!.conversation.id,
        organizationId: session.organizationId,
        text: args.text,
        aiConnectionId: connectionId,
        aiSenderName: assistantName,
        // La misma vía que la persona en la Bandeja (Meta, Directa o Automática).
        allowDirect: true,
      });
      return {
        data: {
          ok: true,
          message_id: res.messageId,
          queued_until: res.queuedUntil?.toISOString() ?? null,
          sent_today: sent + 1,
          daily_limit: dailyMessageLimit,
        },
        summary: `envió ${args.text.length} caracteres`,
        ...ids,
      };
    } catch (err) {
      if (err instanceof SendError) return fail(err.message, `no se envió (${err.code})`, ids);
      throw err;
    }
  },
};

const tagChatArgs = z
  .object({
    conversation_id: z.string().min(1).max(60),
    add: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    remove: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  })
  .refine((a) => a.add.length + a.remove.length > 0, "Indica al menos una etiqueta en add o remove");

const tagChat: ToolSpec<z.infer<typeof tagChatArgs>> = {
  name: "tag_chat",
  title: "Etiquetar un chat",
  description:
    "Pone o quita etiquetas al contacto de un chat, por nombre (las de list_tags). No crea etiquetas nuevas.",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: { type: "string" },
      add: { type: "array", items: { type: "string" }, maxItems: 20 },
      remove: { type: "array", items: { type: "string" }, maxItems: 20 },
    },
    required: ["conversation_id"],
    additionalProperties: false,
  },
  parse: tagChatArgs,
  scope: "write",
  run: async ({ session }, args) => {
    const found = await getConversation(session.access, args.conversation_id);
    if (!found) return NOT_FOUND;
    const ids = { conversationId: found.conversation.id, contactId: found.contact.id };
    const all = await listTags(session.organizationId);
    const byName = new Map(all.map((t) => [t.name.toLocaleLowerCase("es"), t]));
    const unknown = [...args.add, ...args.remove].filter((n) => !byName.has(n.toLocaleLowerCase("es")));
    if (unknown.length > 0) {
      return fail(
        `No existen estas etiquetas: ${unknown.join(", ")}. Las que hay: ${all.map((t) => t.name).join(", ") || "ninguna"}`,
        "etiqueta desconocida",
        ids
      );
    }
    const pick = (names: string[]) => names.map((n) => byName.get(n.toLocaleLowerCase("es"))!.id);
    const current = (await tagsForContacts(session.organizationId, [found.contact.id])).get(found.contact.id) ?? [];
    const drop = new Set(pick(args.remove));
    const next = new Set([...current.map((t) => t.id), ...pick(args.add)].filter((id) => !drop.has(id)));
    const tags = await setContactTags(session.organizationId, found.contact.id, [...next], session.userId);
    touched(session.organizationId, found.conversation.id);
    return {
      data: { ok: true, tags: tags.map((t) => t.name) },
      summary: `+${args.add.length} −${args.remove.length} etiquetas`,
      ...ids,
    };
  },
};

const moveStageArgs = z.object({
  conversation_id: z.string().min(1).max(60),
  stage: z.string().trim().min(1).max(80),
  loss_reason: z.string().trim().min(1).max(60).optional(),
});

const moveStage: ToolSpec<z.infer<typeof moveStageArgs>> = {
  name: "move_stage",
  title: "Mover de etapa",
  description:
    "Mueve el lead del contacto de un chat a otra etapa del pipeline (nombre de list_stages). " +
    "Para una etapa perdida (lost) pide loss_reason: si falta, la respuesta trae los motivos válidos.",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: { type: "string" },
      stage: { type: "string", description: "Nombre de la etapa" },
      loss_reason: { type: "string", description: "Motivo de pérdida (solo etapas lost)" },
    },
    required: ["conversation_id", "stage"],
    additionalProperties: false,
  },
  parse: moveStageArgs,
  scope: "write",
  run: async ({ session }, args) => {
    const found = await getConversation(session.access, args.conversation_id);
    if (!found) return NOT_FOUND;
    const ids = { conversationId: found.conversation.id, contactId: found.contact.id };
    const current = await getContactStage(session.access, found.contact.id);
    if (!current) return fail("Este contacto no tiene lead en el pipeline", "sin lead", ids);
    const stages = await getDb()
      .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name, kind: schema.pipelineStage.kind })
      .from(schema.pipelineStage)
      .where(scoped(schema.pipelineStage.organizationId, session.organizationId))
      .orderBy(asc(schema.pipelineStage.position));
    const wanted = args.stage.toLocaleLowerCase("es");
    const to = stages.find((st) => st.id === args.stage || st.name.toLocaleLowerCase("es") === wanted);
    if (!to) {
      return fail(`No existe la etapa «${args.stage}». Las que hay: ${stages.map((st) => st.name).join(", ")}`, "etapa desconocida", ids);
    }
    let lossKey: string | null = null;
    if (to.kind === "lost") {
      const reasons = (await listLossReasons(session.organizationId)).filter((r) => r.active);
      const r = args.loss_reason?.toLocaleLowerCase("es");
      const match = r ? reasons.find((x) => x.key === args.loss_reason || x.label.toLocaleLowerCase("es") === r) : undefined;
      if (!match) {
        return fail(
          `Para «${to.name}» hace falta loss_reason. Los motivos válidos: ${reasons.map((x) => x.label).join(", ")}`,
          "falta motivo de pérdida",
          ids
        );
      }
      lossKey = match.key;
    }
    const res = await moveLeadToStage({
      organizationId: session.organizationId,
      leadId: current.lead.id,
      toStageId: to.id,
      actorUserId: session.userId,
      source: "dueno",
      lossReason: lossKey,
      lossNote: null,
    });
    if (!res.ok) return fail("No se pudo mover el lead", `no se movió (${res.reason})`, ids);
    touched(session.organizationId, found.conversation.id);
    return { data: { ok: true, from: current.stage.name, to: to.name }, summary: `etapa → ${to.name}`.slice(0, 200), ...ids };
  },
};

const addNoteArgs = z.object({
  conversation_id: z.string().min(1).max(60),
  text: z.string().trim().min(1).max(4000),
});

const addNote: ToolSpec<z.infer<typeof addNoteArgs>> = {
  name: "add_note",
  title: "Añadir una nota",
  description: "Añade una nota interna a la línea de tiempo del chat (el cliente nunca la ve). Queda a nombre de la persona.",
  inputSchema: {
    type: "object",
    properties: { conversation_id: { type: "string" }, text: { type: "string", minLength: 1, maxLength: 4000 } },
    required: ["conversation_id", "text"],
    additionalProperties: false,
  },
  parse: addNoteArgs,
  scope: "write",
  run: async ({ session }, args) => {
    const found = await getConversation(session.access, args.conversation_id);
    if (!found) return NOT_FOUND;
    await logActivity({
      organizationId: session.organizationId,
      contactId: found.contact.id,
      kind: "note_added",
      actorUserId: session.userId,
      source: "usuario",
      detail: { text: args.text },
    });
    touched(session.organizationId, found.conversation.id);
    return {
      data: { ok: true },
      summary: `nota de ${args.text.length} caracteres`,
      conversationId: found.conversation.id,
      contactId: found.contact.id,
    };
  },
};

const createTaskArgs = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX),
  description: z.string().trim().max(TASK_DESCRIPTION_MAX).optional(),
  due_at: z.string().datetime({ offset: true }).optional(),
  conversation_id: z.string().min(1).max(60).optional(),
});

const createTaskTool: ToolSpec<z.infer<typeof createTaskArgs>> = {
  name: "create_task",
  title: "Crear una tarea",
  description:
    "Crea una tarea para la persona (Tareas y notas del CRM), opcionalmente ligada a un chat. " +
    "due_at en ISO 8601 con zona horaria, p. ej. 2026-11-03T10:00:00-06:00.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: TASK_TITLE_MAX },
      description: { type: "string", maxLength: TASK_DESCRIPTION_MAX },
      due_at: { type: "string", format: "date-time" },
      conversation_id: { type: "string" },
    },
    required: ["title"],
    additionalProperties: false,
  },
  parse: createTaskArgs,
  scope: "write",
  available: (org) => orgHasModule(org, "trabajo"),
  run: async ({ session }, args) => {
    try {
      const task = await createTask(viewerOf(session), {
        title: args.title,
        description: args.description ?? null,
        dueAt: args.due_at ? new Date(args.due_at) : null,
        conversationId: args.conversation_id ?? null,
      });
      return {
        data: { ok: true, task_id: task.id },
        summary: "creó una tarea",
        conversationId: task.conversationId,
        contactId: task.contact?.id ?? null,
      };
    } catch (err) {
      if (err instanceof TaskInputError) return fail(err.message, "tarea no válida");
      throw err;
    }
  },
};

const assignChatArgs = z.object({
  conversation_id: z.string().min(1).max(60),
  /** Nombre de list_people; null = sin asignar. */
  to: z.string().trim().min(1).max(120).nullable(),
});

const assignChat: ToolSpec<z.infer<typeof assignChatArgs>> = {
  name: "assign_chat",
  title: "Asignar un chat",
  description: "Asigna el chat (y su lead) a una persona del equipo por nombre (de list_people), o null para dejarlo sin asignar.",
  inputSchema: {
    type: "object",
    properties: { conversation_id: { type: "string" }, to: { type: ["string", "null"] } },
    required: ["conversation_id", "to"],
    additionalProperties: false,
  },
  parse: assignChatArgs,
  scope: "write",
  permission: "assignment.manage",
  run: async ({ session }, args) => {
    const found = await getConversation(session.access, args.conversation_id);
    if (!found) return NOT_FOUND;
    const ids = { conversationId: found.conversation.id, contactId: found.contact.id };
    let toUserId: string | null = null;
    let toName = "sin asignar";
    if (args.to !== null) {
      const people = await listAssignees(session.organizationId);
      const wanted = args.to.toLocaleLowerCase("es");
      const matches = people.filter((p) => p.name.toLocaleLowerCase("es") === wanted);
      if (matches.length !== 1) {
        return fail(
          matches.length > 1
            ? `Hay ${matches.length} personas llamadas «${args.to}»: asígnalo desde la Bandeja`
            : `No hay nadie llamado «${args.to}». El equipo: ${people.map((p) => p.name).join(", ")}`,
          "persona no encontrada",
          ids
        );
      }
      toUserId = matches[0]!.id;
      toName = matches[0]!.name;
    }
    const res = await assignContacts({
      organizationId: session.organizationId,
      contactIds: [found.contact.id],
      toUserId,
      actorUserId: session.userId,
      source: "manual",
    });
    if (!res.ok) return fail("No se pudo asignar", `no se asignó (${res.reason})`, ids);
    return { data: { ok: true, assigned_to: toUserId ? toName : null }, summary: "reasignó el chat", ...ids };
  },
};

const WRITE_TOOLS = [sendMessage, tagChat, moveStage, addNote, createTaskTool, assignChat];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cada herramienta valida sus propios argumentos
export const TOOLS: readonly ToolSpec<any>[] = [
  listChats,
  readChat,
  listStages,
  listTagsTool,
  listQuickRepliesTool,
  listTasksTool,
  listPeople,
  ...WRITE_TOOLS,
  ...CHAT_TOOLS,
  ...CRM_TOOLS,
  ...EXTRA_TOOLS,
  ...ADVANCED_TOOLS,
  ...KNOWLEDGE_TOOLS,
  ...LIBRARY_TOOLS,
];

/** Las herramientas que ESTA conexión puede usar hoy (alcance, permisos, módulos y funciones avanzadas). */
export async function toolsFor(session: SessionContext, scopes: readonly Scope[]) {
  const settings = await getConnectorSettings(session.organizationId);
  const out = [];
  for (const t of TOOLS) {
    if (!scopes.includes(t.scope)) continue;
    if (t.permission && !can(session, t.permission)) continue;
    if (t.area && !advancedAllows(session.role, settings, t.area)) continue;
    if (t.launch && !settings.advanced.launchCampaigns) continue;
    if (t.available && !(await t.available(session.organizationId))) continue;
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
    annotations: {
      title: t.title,
      readOnlyHint: t.scope === "read",
      destructiveHint: false,
      // Enviar un WhatsApp (o una campaña) sale del CRM hacia personas reales.
      openWorldHint: t.name === "send_message" || t.name === "send_template" || t.name === "launch_campaign",
    },
  };
}
