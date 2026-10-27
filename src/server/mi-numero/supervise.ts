import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { runWithOrganization } from "@/lib/request-context";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { SUPERVISOR_ROLES } from "./audience";
import { MiNumeroFailure } from "./numbers";

/**
 * Mi número (046), PR 7 — Lo que ve quien supervisa los números del equipo
 * (Propietario y Coordinador, `mi_numero.manage`):
 *
 * - Los chats de los números «de la empresa», en SOLO LECTURA (contestar es
 *   de quien tiene el teléfono). No los marca leídos y cada vista queda en
 *   «Quién ha visto tus chats» de quien lleva el número.
 * - De los números PERSONALES, nada salvo lo que su dueño ya compartió: los
 *   chats que marcó «Es cliente», y solo si permite solicitudes. De esos ve el
 *   cliente, el dueño y la fecha, y puede PEDIR verlos (aunque él no atienda
 *   a ese cliente); el dueño decide, como con cualquier solicitud.
 *
 * Las consultas usan `scoped()` a propósito (como `chats.ts`):
 * `scopedContacts()` esconde los chats de los números.
 */

const liveNumber = () => isNull(schema.directNumber.revokedAt);

/** Defensa extra a la de la ruta: el rol de esta persona hoy, en la base. */
async function assertSupervisor(organizationId: string, userId: string): Promise<void> {
  const [m] = await getDb()
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(scoped(schema.member.organizationId, organizationId, eq(schema.member.userId, userId)))
    .limit(1);
  if (!m || !SUPERVISOR_ROLES.includes(m.role)) throw new MiNumeroFailure("not_found");
}

export type TeamChatDto = {
  id: string;
  contactName: string;
  phone: string | null;
  preview: string | null;
  lastMessageAt: string | null;
  clientMarkedAt: string | null;
};
export type CompanyNumberDto = { numberId: string; ownerName: string; label: string | null; chats: TeamChatDto[] };
export type RequestableDto = {
  conversationId: string;
  ownerName: string;
  contactName: string;
  since: string;
  access: "none" | "pending" | "granted" | "rejected";
};
export type TeamNumbers = { companyNumbers: CompanyNumberDto[]; requestable: RequestableDto[] };

/** Cuántos chats por número trae la vista (los más recientes). */
const CHATS_PER_NUMBER = 200;

export async function teamNumbers(organizationId: string, userId: string): Promise<TeamNumbers> {
  await assertSupervisor(organizationId, userId);
  const db = getDb();
  const numbers = await db
    .select({ id: schema.directNumber.id, label: schema.directNumber.label, ownerName: schema.user.name })
    .from(schema.directNumber)
    .innerJoin(schema.user, eq(schema.user.id, schema.directNumber.userId))
    .where(
      scoped(
        schema.directNumber.organizationId,
        organizationId,
        eq(schema.directNumber.kind, "empresa"),
        ne(schema.directNumber.userId, userId),
        liveNumber()
      )
    )
    .orderBy(schema.user.name);

  const preview = sql<string | null>`(
    select coalesce(m.text, m.type) from message m
    where m.organization_id = ${organizationId} and m.conversation_id = ${schema.conversation.id}
    order by m.created_at desc limit 1
  )`;
  const companyNumbers: CompanyNumberDto[] = [];
  for (const n of numbers) {
    const rows = await db
      .select({ conversation: schema.conversation, contactName: schema.contact.name, phone: schema.contact.phone, preview })
      .from(schema.conversation)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          eq(schema.conversation.directNumberId, n.id),
          isNull(schema.conversation.archivedAt)
        )
      )
      .orderBy(desc(sql`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`))
      .limit(CHATS_PER_NUMBER);
    companyNumbers.push({
      numberId: n.id,
      ownerName: n.ownerName,
      label: n.label,
      chats: rows.map((r) => ({
        id: r.conversation.id,
        contactName: r.contactName,
        phone: r.phone,
        preview: r.preview,
        lastMessageAt: r.conversation.lastMessageAt?.toISOString() ?? null,
        clientMarkedAt: r.conversation.clientMarkedAt?.toISOString() ?? null,
      })),
    });
  }
  return { companyNumbers, requestable: await requestableChats(organizationId, userId) };
}

/** Los chats de cliente de números personales ajenos que su dueño deja pedir. */
async function requestableChats(organizationId: string, userId: string, only?: string): Promise<RequestableDto[]> {
  const db = getDb();
  const rows = await db
    .select({ conversation: schema.conversation, ownerName: schema.user.name, contactName: schema.contact.name })
    .from(schema.conversation)
    .innerJoin(schema.directNumber, eq(schema.directNumber.id, schema.conversation.directNumberId))
    .innerJoin(schema.user, eq(schema.user.id, schema.directNumber.userId))
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        only ? eq(schema.conversation.id, only) : undefined,
        isNotNull(schema.conversation.clientMarkedAt),
        eq(schema.directNumber.kind, "personal"),
        eq(schema.directNumber.allowViewRequests, true),
        ne(schema.directNumber.userId, userId),
        liveNumber()
      )
    )
    .orderBy(desc(schema.conversation.clientMarkedAt))
    .limit(500);
  if (rows.length === 0) return [];
  const mine = await db
    .select()
    .from(schema.conversationAccess)
    .where(
      scoped(
        schema.conversationAccess.organizationId,
        organizationId,
        eq(schema.conversationAccess.userId, userId),
        inArray(schema.conversationAccess.conversationId, rows.map((r) => r.conversation.id))
      )
    )
    .orderBy(desc(schema.conversationAccess.requestedAt));
  return rows.map((r) => {
    const last = mine.find((a) => a.conversationId === r.conversation.id);
    return {
      conversationId: r.conversation.id,
      ownerName: r.ownerName,
      contactName: r.contactName,
      since: (r.conversation.clientMarkedAt ?? r.conversation.createdAt).toISOString(),
      access: last && last.status !== "revoked" ? last.status : "none",
    };
  });
}

/** Pedir ver un chat de cliente de un número personal, sin atender al cliente. */
export async function requestAccessAsSupervisor(organizationId: string, userId: string, conversationId: string): Promise<void> {
  await assertSupervisor(organizationId, userId);
  const [target] = await requestableChats(organizationId, userId, conversationId);
  if (!target) {
    // ¿Existe pero su dueño no recibe solicitudes? Se dice claro; si no, no existe.
    const [exists] = await getDb()
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .innerJoin(schema.directNumber, eq(schema.directNumber.id, schema.conversation.directNumberId))
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          eq(schema.conversation.id, conversationId),
          isNotNull(schema.conversation.clientMarkedAt),
          eq(schema.directNumber.kind, "personal"),
          ne(schema.directNumber.userId, userId),
          liveNumber()
        )
      )
      .limit(1);
    throw new MiNumeroFailure(exists ? "requests_off" : "not_found");
  }
  if (target.access === "pending" || target.access === "granted") return;
  await getDb()
    .insert(schema.conversationAccess)
    .values({ id: newId("conversationAccess"), organizationId, conversationId, userId })
    .onConflictDoNothing();
  await notifyOwner(organizationId, conversationId);
}

/** El chat de un número «de la empresa» ajeno (o `not_found`). */
async function companyNumberChat(organizationId: string, userId: string, conversationId: string) {
  const [row] = await getDb()
    .select({ conversation: schema.conversation, ownerId: schema.directNumber.userId })
    .from(schema.conversation)
    .innerJoin(schema.directNumber, eq(schema.directNumber.id, schema.conversation.directNumberId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        and(
          eq(schema.conversation.id, conversationId),
          eq(schema.directNumber.kind, "empresa"),
          ne(schema.directNumber.userId, userId)
        ),
        liveNumber()
      )
    )
    .limit(1);
  if (!row) throw new MiNumeroFailure("not_found");
  return row;
}

/** Leer un chat de un número de la empresa: solo lectura, sin marcarlo leído, y queda anotado. */
export async function companyNumberChatMessages(organizationId: string, userId: string, conversationId: string) {
  await assertSupervisor(organizationId, userId);
  const { conversation, ownerId } = await companyNumberChat(organizationId, userId, conversationId);
  const db = getDb();
  await db.insert(schema.conversationAccessLog).values({ id: newId("conversationAccessLog"), organizationId, conversationId, userId });
  publish(organizationId, { type: "number.conversation", data: { conversationId }, audience: [ownerId] });
  const rows = await db
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(schema.mediaAsset, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
    .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.conversationId, conversation.id)))
    .orderBy(schema.message.createdAt);
  return rows.map((r) => serializeMessage(r.message, r.media));
}

/** Un adjunto de un chat de un número de la empresa, para quien supervisa (null si no). */
export async function supervisedNumberAsset(organizationId: string, userId: string, assetId: string) {
  const [m] = await getDb()
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(scoped(schema.member.organizationId, organizationId, eq(schema.member.userId, userId)))
    .limit(1);
  if (!m || !SUPERVISOR_ROLES.includes(m.role)) return null;
  const [row] = await getDb()
    .select({ asset: schema.mediaAsset })
    .from(schema.mediaAsset)
    .innerJoin(schema.message, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.message.conversationId))
    .innerJoin(schema.directNumber, eq(schema.directNumber.id, schema.conversation.directNumberId))
    .where(
      scoped(
        schema.mediaAsset.organizationId,
        organizationId,
        eq(schema.mediaAsset.id, assetId),
        eq(schema.directNumber.kind, "empresa"),
        liveNumber()
      )
    )
    .limit(1);
  return row?.asset ?? null;
}

async function notifyOwner(organizationId: string, conversationId: string) {
  const [row] = await getDb()
    .select({ ownerId: schema.directNumber.userId })
    .from(schema.conversation)
    .innerJoin(schema.directNumber, eq(schema.directNumber.id, schema.conversation.directNumberId))
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  if (row) publish(organizationId, { type: "number.conversation", data: { conversationId }, audience: [row.ownerId] });
}

/** ¿Hay números del equipo que supervisar? (para la pestaña de la Bandeja; el permiso lo revisa quien llama). */
export async function seesTeamNumbers(organizationId: string, userId: string): Promise<boolean> {
  return runWithOrganization(organizationId, async () => {
    const [row] = await getDb()
      .select({ id: schema.directNumber.id })
      .from(schema.directNumber)
      .where(scoped(schema.directNumber.organizationId, organizationId, ne(schema.directNumber.userId, userId), liveNumber()))
      .limit(1);
    return !!row;
  });
}
