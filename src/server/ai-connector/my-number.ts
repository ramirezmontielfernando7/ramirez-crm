import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { SessionContext } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getOrgModules } from "@/server/modules";
import { miNumeroMessage } from "@/server/mi-numero/http";
import { MiNumeroFailure } from "@/server/mi-numero/numbers";
import { sendFromMyNumber } from "@/server/mi-numero/send";

/**
 * 047 PR 4b — «Mi IA puede ver y contestar mis chats de cliente» (el quinto
 * interruptor de «Mi número», `direct_number.ai_connector`, APAGADO).
 *
 * - Solo el número VIVO de quien conectó la IA (la sesión decide; nunca un
 *   id que mande la IA): nadie ve por aquí el número de otro.
 * - Solo los chats marcados «Es cliente», con «Compartir mis clientes» y el
 *   quinto interruptor encendidos. Los privados no existen para la IA.
 * - Contestar sale por el dispositivo del número con sus límites y su fila
 *   (`sendFromMyNumber`), marcado como de la IA conectada.
 */

type NumberRow = typeof schema.directNumber.$inferSelect;
type ConversationRow = typeof schema.conversation.$inferSelect;
type ContactRow = typeof schema.contact.$inferSelect;

/** El número de quien pide, si su IA puede usarlo hoy; si no, null. */
export async function aiNumberOf(session: SessionContext): Promise<NumberRow | null> {
  const modules = await getOrgModules(session.organizationId);
  if (!modules.miNumero || !modules.conexionDirecta || !modules.conectorIa) return null;
  const [row] = await getDb()
    .select()
    .from(schema.directNumber)
    .where(
      scoped(
        schema.directNumber.organizationId,
        session.organizationId,
        eq(schema.directNumber.userId, session.userId),
        isNull(schema.directNumber.revokedAt)
      )
    )
    .limit(1);
  if (!row || !row.aiConnector || !row.shareClients) return null;
  return row;
}

function clientChatOf(number: NumberRow) {
  return and(eq(schema.conversation.directNumberId, number.id), isNotNull(schema.conversation.clientMarkedAt));
}

export type AiNumberChat = {
  conversation: ConversationRow;
  contact: ContactRow;
  preview: string | null;
};

/** Los chats de cliente de MI número, del más reciente al más viejo. */
export async function listAiNumberChats(
  session: SessionContext,
  number: NumberRow,
  opts: { query: string; limit: number; archived: boolean; unread: boolean }
): Promise<AiNumberChat[]> {
  const org = session.organizationId;
  const preview = sql<string | null>`(
    select coalesce(m.text, m.type) from message m
    where m.organization_id = ${org} and m.conversation_id = ${schema.conversation.id}
    order by m.created_at desc limit 1
  )`;
  const q = opts.query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return getDb()
    .select({ conversation: schema.conversation, contact: schema.contact, preview })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      and(eq(schema.contact.organizationId, schema.conversation.organizationId), eq(schema.contact.id, schema.conversation.contactId))
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        org,
        clientChatOf(number),
        opts.archived ? isNotNull(schema.conversation.archivedAt) : isNull(schema.conversation.archivedAt),
        opts.unread ? sql`${schema.conversation.unreadCount} > 0` : undefined,
        q ? or(ilike(schema.contact.name, `%${q}%`), ilike(schema.contact.phone, `%${q}%`)) : undefined
      )
    )
    .orderBy(desc(sql`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`))
    .limit(opts.limit);
}

/** Un chat de cliente de MI número, o null (uno privado o ajeno no existe). */
export async function aiNumberChat(session: SessionContext, conversationId: string): Promise<AiNumberChat | null> {
  const number = await aiNumberOf(session);
  if (!number) return null;
  const [row] = await getDb()
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      and(eq(schema.contact.organizationId, schema.conversation.organizationId), eq(schema.contact.id, schema.conversation.contactId))
    )
    .where(
      scoped(schema.conversation.organizationId, session.organizationId, eq(schema.conversation.id, conversationId), clientChatOf(number))
    )
    .limit(1);
  return row ? { ...row, preview: null } : null;
}

/** Los últimos mensajes de un chat ya revisado con `aiNumberChat` (no lo marca leído). */
export async function aiNumberMessages(session: SessionContext, conversationId: string, limit: number) {
  const rows = await getDb()
    .select({ message: schema.message, mediaKind: schema.mediaAsset.kind })
    .from(schema.message)
    .leftJoin(schema.mediaAsset, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
    .where(scoped(schema.message.organizationId, session.organizationId, eq(schema.message.conversationId, conversationId)))
    .orderBy(desc(schema.message.createdAt))
    .limit(limit);
  return rows.reverse();
}

export type AiNumberSend =
  | { ok: true; messageId: string; queuedUntil: Date | null }
  | { ok: false; code: string; message: string };

/**
 * Contesta por MI número como la IA conectada (vuelve a revisar el chat).
 * null = el chat ya no es de cliente o el interruptor se apagó. Los errores
 * del número y del envío vuelven en palabras (sin importar la vía directa:
 * guardarraíl `conexion-directa-envio.test.ts`).
 */
export async function sendAsMyNumberAi(
  session: SessionContext,
  conversationId: string,
  text: string,
  via: { aiConnectionId: string; aiSenderName: string | null }
): Promise<AiNumberSend | null> {
  const chat = await aiNumberChat(session, conversationId);
  if (!chat) return null;
  try {
    const res = await sendFromMyNumber(session.organizationId, session.userId, chat.conversation.id, { text }, via);
    return { ok: true, messageId: res.messageId, queuedUntil: res.queuedUntil };
  } catch (err) {
    if (err instanceof MiNumeroFailure) return { ok: false, code: err.code, message: miNumeroMessage(err.code) };
    // `DirectSendFailure` (no salió): por nombre, para no importar la vía directa.
    if (err instanceof Error && err.name === "DirectSendFailure") {
      return { ok: false, code: (err as Error & { code?: string }).code ?? "failed", message: err.message };
    }
    throw err;
  }
}
