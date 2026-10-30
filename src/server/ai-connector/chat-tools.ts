import { eq } from "drizzle-orm";
import { z } from "zod";
import type { SessionContext } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { companyChat, scoped, scopedContacts } from "@/lib/db/tenant";
import { logActivitySafe } from "@/server/activity/log";
import { getConnectorSettings } from "@/server/ai-connector/settings";
import { messagesSentLastDay } from "@/server/ai-connector/log";
import type { ToolContext, ToolOutcome, ToolSpec } from "@/server/ai-connector/tools";
import { getContactById } from "@/server/contacts";
import { publish } from "@/server/events/bus";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { setConversationArchived } from "@/server/inbox/lifecycle";
import { assertMayStartChat, NewNumberError, openChat } from "@/server/inbox/new-number";
import { getConversation, updateConversation } from "@/server/inbox/queries";
import { SendError } from "@/server/inbox/send";
import { isWindowOpen } from "@/server/inbox/window";
import { countVariables } from "@/lib/templates";
import { sendTemplate, templateSendability, TemplateError } from "@/server/whatsapp/templates";

/**
 * 047 — Abrir chats y escribir primero, lo mismo que la Bandeja deja a
 * cualquier rol: «Abrir chat» con un contacto (aunque nunca haya escrito),
 * mandarle una plantilla aprobada y archivar, marcar leído o pausar la IA
 * del chat. Cada una por la MISMA puerta que la pantalla
 * (`openChat`/`assertMayStartChat`, `sendTemplate`, `updateConversation`),
 * así que el asesor solo abre lo suyo y respeta «Chats nuevos de los
 * asesores». Solo chats de la empresa: «Mi número» no se abre desde aquí.
 */

function fail(error: string, summary: string, extra: Partial<ToolOutcome> = {}): ToolOutcome {
  return { data: { error }, summary, isError: true, ...extra };
}

const CHAT_NOT_FOUND = fail("No existe o no tienes acceso a ese chat", "chat no encontrado");
const CONTACT_NOT_FOUND = fail("No existe o no tienes acceso a ese contacto", "contacto no encontrado");

function touched(organizationId: string, conversationId: string) {
  publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversationId } } });
}

/** El chat de la empresa con ese contacto que la sesión ve, si ya existe. */
async function companyChatOf(session: SessionContext, contactId: string) {
  const [row] = await getDb()
    .select({ id: schema.conversation.id, lastInboundAt: schema.conversation.lastInboundAt })
    .from(schema.conversation)
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        session.access,
        schema.conversation.contactId,
        eq(schema.conversation.contactId, contactId),
        companyChat()
      )
    )
    .limit(1);
  return row ?? null;
}

const openChatArgs = z
  .object({
    contact_id: z.string().min(1).max(60).optional(),
    phone: z.string().trim().min(1).max(40).optional(),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .refine((a) => Boolean(a.contact_id) !== Boolean(a.phone), "Indica contact_id o phone (solo uno)");

const openChatTool: ToolSpec<z.infer<typeof openChatArgs>> = {
  name: "open_chat",
  title: "Abrir un chat",
  description:
    "Abre (o crea, vacío) el chat de WhatsApp de la empresa con un contacto, igual que «Abrir chat» en la Bandeja: " +
    "por contact_id (por ejemplo, uno recién importado) o por phone (si el número no existe, registra el contacto con name). " +
    "No envía nada. Devuelve conversation_id y window_open: con la ventana cerrada, el primer mensaje por Meta " +
    "tiene que ser una plantilla (send_template); en Conexión directa o híbrida también sirve send_message.",
  inputSchema: {
    type: "object",
    properties: {
      contact_id: { type: "string", description: "Id del contacto (de list_chats, read_contact o una importación)" },
      phone: { type: "string", description: "Teléfono con lada, por ejemplo 5215512345678" },
      name: { type: "string", description: "Nombre, solo si el teléfono es nuevo" },
    },
    additionalProperties: false,
  },
  parse: openChatArgs,
  scope: "write",
  run: async ({ session }, args) => {
    try {
      if (args.phone) {
        const opened = await openChat(session, args.phone);
        let contact = opened.contact;
        // Sin nombre, el contacto nuevo se llama como su teléfono: se le pone el que dio la IA.
        if (opened.created && args.name && contact.name !== args.name) {
          const [renamed] = await getDb()
            .update(schema.contact)
            .set({ name: args.name, nameSource: "manual", updatedAt: new Date() })
            .where(scoped(schema.contact.organizationId, session.organizationId, eq(schema.contact.id, contact.id)))
            .returning();
          contact = renamed ?? contact;
        }
        const chat = await companyChatOf(session, contact.id);
        touched(session.organizationId, opened.conversationId);
        return {
          data: {
            ok: true,
            conversation_id: opened.conversationId,
            contact: { id: contact.id, name: contact.name, phone: contact.phone },
            contact_created: opened.created,
            window_open: isWindowOpen(chat?.lastInboundAt ?? null),
          },
          summary: opened.created ? "registró el contacto y abrió su chat" : "abrió un chat",
          conversationId: opened.conversationId,
          contactId: contact.id,
        };
      }

      const contact = await getContactById(session.access, args.contact_id!);
      if (!contact || contact.privateToNumberId) return CONTACT_NOT_FOUND;
      if (contact.channel !== "whatsapp" || (!contact.phone && !contact.waIdentity)) {
        return fail("Este contacto no tiene un WhatsApp a dónde escribir", "sin WhatsApp", { contactId: contact.id });
      }
      const existing = await companyChatOf(session, contact.id);
      await assertMayStartChat(session, existing !== null);
      const conversation = existing ?? (await getOrCreateConversation(session.organizationId, contact.id));
      touched(session.organizationId, conversation.id);
      return {
        data: {
          ok: true,
          conversation_id: conversation.id,
          contact: { id: contact.id, name: contact.name, phone: contact.phone },
          already_existed: existing !== null,
          window_open: isWindowOpen(conversation.lastInboundAt),
        },
        summary: existing ? "abrió un chat" : "abrió un chat nuevo",
        conversationId: conversation.id,
        contactId: contact.id,
      };
    } catch (err) {
      if (err instanceof NewNumberError) {
        return fail(err.message, `no se abrió (${err.code})`, {
          outcome: err.code === "new_chats_blocked" ? "denied" : undefined,
        });
      }
      throw err;
    }
  },
};

async function sendableTemplates(organizationId: string) {
  const rows = await getDb()
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.status, "approved")));
  return rows.filter((t) => templateSendability(t).sendable);
}

const empty = z.object({}).strict();

const listChatTemplates: ToolSpec<z.infer<typeof empty>> = {
  name: "list_chat_templates",
  title: "Ver plantillas para escribir primero",
  description:
    "Las plantillas aprobadas por Meta que se pueden mandar en un chat con la ventana de 24 h cerrada (send_template), " +
    "con su texto y cuántas variables {{1}}… piden.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  parse: empty,
  scope: "read",
  run: async ({ session }) => {
    const rows = await sendableTemplates(session.organizationId);
    return {
      data: {
        templates: rows.map((t) => ({
          id: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          body: t.body,
          variables: countVariables(t.body),
        })),
      },
      summary: `${rows.length} plantillas`,
    };
  },
};

const sendTemplateArgs = z.object({
  conversation_id: z.string().min(1).max(60),
  template: z.string().trim().min(1).max(200),
  variables: z.array(z.string().trim().max(500)).max(10).default([]),
});

const sendTemplateTool: ToolSpec<z.infer<typeof sendTemplateArgs>> = {
  name: "send_template",
  title: "Enviar una plantilla",
  description:
    "Manda una plantilla aprobada (nombre o id de list_chat_templates) en un chat de la empresa, como la persona: " +
    "es la forma de escribir PRIMERO o de retomar un chat con la ventana de 24 h cerrada. Un valor en variables por cada {{n}}, en orden. " +
    "Si la ventana está abierta no se gasta plantilla: usa send_message. A quien nunca ha escrito solo se le manda si aceptó " +
    "recibir mensajes (consentimiento); a quien pidió no recibirlos, nunca. Cuenta para el tope diario de mensajes.",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: { type: "string" },
      template: { type: "string", description: "Nombre o id de la plantilla" },
      variables: { type: "array", items: { type: "string" }, maxItems: 10 },
    },
    required: ["conversation_id", "template"],
    additionalProperties: false,
  },
  parse: sendTemplateArgs,
  scope: "write",
  serial: true,
  run: async ({ session, connectionId, assistantName }: ToolContext, args) => {
    const found = await getConversation(session.access, args.conversation_id);
    if (!found) return CHAT_NOT_FOUND;
    const { conversation, contact } = found;
    const ids = { conversationId: conversation.id, contactId: contact.id };

    if (isWindowOpen(conversation.lastInboundAt)) {
      return fail(
        "Esta persona escribió hace menos de 24 h: contéstale con send_message, sin gastar plantilla",
        "ventana abierta",
        ids
      );
    }
    if (contact.waConsent === "opt_out") {
      return fail("Esta persona pidió no recibir mensajes de la empresa", "pidió no recibir mensajes", {
        ...ids,
        outcome: "denied",
      });
    }
    // Escribir PRIMERO (nunca ha escrito) es lo de «Número no registrado» y
    // las campañas: solo a quien aceptó. La IA no puede declararlo por la persona.
    if (!conversation.lastInboundAt && contact.waConsent !== "opt_in") {
      return fail(
        "No consta que esta persona aceptó recibir WhatsApp de la empresa. Una persona del equipo tiene que escribirle primero desde la Bandeja (declarando que aceptó) o importarla con consentimiento.",
        "sin consentimiento",
        { ...ids, outcome: "denied" }
      );
    }

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

    const wanted = args.template.toLocaleLowerCase("es");
    const template = (await sendableTemplates(session.organizationId)).find(
      (t) => t.id === args.template || t.name.toLocaleLowerCase("es") === wanted
    );
    if (!template) return fail("No hay una plantilla aprobada con ese nombre o id (mira list_chat_templates)", "plantilla no encontrada", ids);

    try {
      const res = await sendTemplate({
        organizationId: session.organizationId,
        conversationId: conversation.id,
        templateId: template.id,
        variables: args.variables,
        aiConnectionId: connectionId,
        aiSenderName: assistantName,
      });
      return {
        data: { ok: true, message_id: res.messageId, sent_today: sent + 1, daily_limit: dailyMessageLimit },
        summary: `envió la plantilla ${template.name}`,
        ...ids,
      };
    } catch (err) {
      if (err instanceof TemplateError || err instanceof SendError) {
        return fail(err.message, `no se envió (${err.code})`, ids);
      }
      throw err;
    }
  },
};

const updateChatArgs = z
  .object({
    conversation_id: z.string().min(1).max(60),
    archived: z.boolean().optional(),
    mark_read: z.boolean().optional(),
    ai_paused: z.boolean().optional(),
  })
  .refine(
    (a) => a.archived !== undefined || a.mark_read !== undefined || a.ai_paused !== undefined,
    "Indica archived, mark_read o ai_paused"
  );

const updateChatTool: ToolSpec<z.infer<typeof updateChatArgs>> = {
  name: "update_chat",
  title: "Archivar, marcar leído o pausar la IA de un chat",
  description:
    "Lo que la Bandeja deja hacer con un chat: archived true lo archiva y false lo recupera; mark_read true lo marca como leído; " +
    "ai_paused true pausa al agente de IA del CRM en ese chat (contesta una persona) y false lo reactiva. No borra nada.",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: { type: "string" },
      archived: { type: "boolean" },
      mark_read: { type: "boolean" },
      ai_paused: { type: "boolean" },
    },
    required: ["conversation_id"],
    additionalProperties: false,
  },
  parse: updateChatArgs,
  scope: "write",
  run: async ({ session }, args) => {
    const visible = await getConversation(session.access, args.conversation_id);
    if (!visible) return CHAT_NOT_FOUND;
    const ids = { conversationId: visible.conversation.id, contactId: visible.contact.id };
    if (args.archived !== undefined) {
      if (!(await setConversationArchived(session.access, ids.conversationId, args.archived))) return CHAT_NOT_FOUND;
    }
    const patch =
      args.ai_paused === undefined
        ? { markRead: args.mark_read }
        : args.ai_paused
          ? { aiEnabled: false, markRead: args.mark_read }
          : { reactivate: true, markRead: args.mark_read };
    const updated = await updateConversation(session.access, ids.conversationId, patch);
    if (!updated) return CHAT_NOT_FOUND;

    // Igual que la Bandeja: pausar o reactivar queda en la línea de tiempo.
    const before = visible.conversation.aiEnabled && !visible.conversation.handoffAt;
    const after = updated.aiEnabled && !updated.handoffAt;
    if (before !== after) {
      await logActivitySafe({
        organizationId: session.organizationId,
        contactId: updated.contactId,
        kind: after ? "ai_resumed" : "ai_paused",
        actorUserId: session.userId,
        source: "usuario",
      });
    }
    touched(session.organizationId, ids.conversationId);

    const did = [
      args.archived === true && "archivó",
      args.archived === false && "recuperó",
      args.mark_read && "marcó leído",
      args.ai_paused === true && "pausó la IA",
      args.ai_paused === false && "reactivó la IA",
    ].filter(Boolean);
    return {
      data: { ok: true, archived: updated.archivedAt !== null, unread: updated.unreadCount, ai_paused: !after },
      summary: did.length ? `${did.join(", ")} un chat` : "revisó un chat",
      ...ids,
    };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cada herramienta valida sus propios argumentos
export const CHAT_TOOLS: readonly ToolSpec<any>[] = [openChatTool, listChatTemplates, sendTemplateTool, updateChatTool];
