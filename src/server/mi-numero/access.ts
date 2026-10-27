import { and, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { roleLabel } from "@/lib/auth/permissions";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { SUPERVISOR_ROLES } from "./audience";
import { myChat } from "./chats";
import { MiNumeroFailure } from "./numbers";

/**
 * Mi número (046), PR 6b — «También habla con…», pedir ver un chat ajeno y
 * la bitácora «Quién ha visto tus chats». Todo con el consentimiento del
 * dueño de cada número:
 *
 * - El aviso solo existe entre chats marcados «Es cliente» de números que
 *   tienen encendido «Avisar que también hablo con este cliente» (parejo: si
 *   lo apagas, tampoco ves el de los demás). Solo nombre y fecha, jamás lo
 *   que se escribieron.
 * - Pedir ver: quien también habla con ese cliente (su chat marcado y su
 *   aviso encendido) y solo si el dueño tiene «Permitir solicitudes». El
 *   dueño acepta o rechaza cada vez y quita el acceso cuando quiera.
 * - Con acceso: SOLO LECTURA de ese chat, y cada vez que lo abre queda en la
 *   bitácora del dueño.
 *
 * Las consultas usan `scoped()` con el número de quien pide, a propósito
 * (como `chats.ts`): `scopedContacts()` esconde los chats de los números.
 */

type NumberRow = typeof schema.directNumber.$inferSelect;
type Access = typeof schema.conversationAccess.$inferSelect;

export type OverlapDto = {
  /** El chat del compañero con este mismo cliente. */
  conversationId: string;
  userName: string;
  since: string;
  canRequest: boolean;
  access: "none" | "pending" | "granted" | "rejected";
};

const liveNumber = () => isNull(schema.directNumber.revokedAt);

/** ¿Quién más habla con el cliente de este chat mío? (vacío si no aplica) */
export async function overlapsFor(organizationId: string, userId: string, conversationId: string): Promise<OverlapDto[]> {
  const { number, conversation } = await myChat(organizationId, userId, conversationId);
  if (!number.overlapNotice || !conversation.clientMarkedAt) return [];
  const others = await getDb()
    .select({ conversation: schema.conversation, number: schema.directNumber, userName: schema.user.name })
    .from(schema.conversation)
    .innerJoin(schema.directNumber, eq(schema.directNumber.id, schema.conversation.directNumberId))
    .innerJoin(schema.user, eq(schema.user.id, schema.directNumber.userId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.contactId, conversation.contactId),
        ne(schema.conversation.id, conversation.id),
        isNotNull(schema.conversation.clientMarkedAt),
        eq(schema.directNumber.overlapNotice, true),
        liveNumber()
      )
    );
  if (others.length === 0) return [];
  const mine = await getDb()
    .select()
    .from(schema.conversationAccess)
    .where(
      scoped(
        schema.conversationAccess.organizationId,
        organizationId,
        eq(schema.conversationAccess.userId, userId),
        inArray(schema.conversationAccess.conversationId, others.map((o) => o.conversation.id))
      )
    )
    .orderBy(desc(schema.conversationAccess.requestedAt));
  return others.map((o) => {
    const last = mine.find((a) => a.conversationId === o.conversation.id);
    return {
      conversationId: o.conversation.id,
      userName: o.userName,
      since: (o.conversation.clientMarkedAt ?? o.conversation.createdAt).toISOString(),
      canRequest: o.number.allowViewRequests,
      access: last && last.status !== "revoked" ? last.status : "none",
    };
  });
}

/** El chat de otro número, con su número vivo (o `not_found`). */
async function numberChat(organizationId: string, conversationId: string) {
  const [row] = await getDb()
    .select({ conversation: schema.conversation, number: schema.directNumber })
    .from(schema.conversation)
    .innerJoin(schema.directNumber, eq(schema.directNumber.id, schema.conversation.directNumberId))
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId), liveNumber()))
    .limit(1);
  if (!row) throw new MiNumeroFailure("not_found");
  return row;
}

function notify(organizationId: string, conversationId: string, audience: string[]) {
  publish(organizationId, { type: "number.conversation", data: { conversationId }, audience });
}

/**
 * Pedir ver el chat de un compañero. Solo si también hablo con ese cliente
 * (mi chat marcado y mi aviso encendido) y él permite solicitudes.
 */
export async function requestAccess(organizationId: string, userId: string, fromConversationId: string, targetConversationId: string): Promise<void> {
  const overlaps = await overlapsFor(organizationId, userId, fromConversationId);
  const o = overlaps.find((x) => x.conversationId === targetConversationId);
  if (!o) throw new MiNumeroFailure("not_found");
  if (!o.canRequest) throw new MiNumeroFailure("requests_off");
  if (o.access === "pending" || o.access === "granted") return;
  const target = await numberChat(organizationId, targetConversationId);
  await getDb()
    .insert(schema.conversationAccess)
    .values({ id: newId("conversationAccess"), organizationId, conversationId: targetConversationId, userId })
    .onConflictDoNothing();
  notify(organizationId, targetConversationId, [target.number.userId]);
}

export type IncomingRequestDto = {
  id: string;
  requesterName: string;
  /** PR 7: el rol de quien supervisa los números (puede pedir sin atender al cliente); null si no. */
  requesterRole: string | null;
  contactName: string;
  conversationId: string;
  requestedAt: string;
};
export type GrantDto = { id: string; userName: string; contactName: string; conversationId: string; since: string };
export type ViewDto = { userName: string; contactName: string; viewedAt: string };
export type SharedChatDto = { conversationId: string; ownerName: string; contactName: string };
export type AccessOverview = {
  incoming: IncomingRequestDto[];
  granted: GrantDto[];
  views: ViewDto[];
  sharedWithMe: SharedChatDto[];
};

/** Lo que el dueño ve (solicitudes, accesos dados, bitácora) y lo que le compartieron. */
export async function accessOverview(organizationId: string, userId: string): Promise<AccessOverview> {
  const db = getDb();
  const [number] = await db
    .select()
    .from(schema.directNumber)
    .where(scoped(schema.directNumber.organizationId, organizationId, eq(schema.directNumber.userId, userId), liveNumber()))
    .limit(1);
  const onMine = number
    ? await db
        .select({ access: schema.conversationAccess, userName: schema.user.name, contactName: schema.contact.name, role: schema.member.role })
        .from(schema.conversationAccess)
        .innerJoin(schema.conversation, eq(schema.conversation.id, schema.conversationAccess.conversationId))
        .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
        .innerJoin(schema.user, eq(schema.user.id, schema.conversationAccess.userId))
        .leftJoin(
          schema.member,
          and(eq(schema.member.userId, schema.conversationAccess.userId), eq(schema.member.organizationId, schema.conversationAccess.organizationId))
        )
        .where(
          scoped(
            schema.conversationAccess.organizationId,
            organizationId,
            eq(schema.conversation.directNumberId, number.id),
            inArray(schema.conversationAccess.status, ["pending", "granted"])
          )
        )
        .orderBy(desc(schema.conversationAccess.requestedAt))
    : [];
  const views = number
    ? await db
        .select({ log: schema.conversationAccessLog, userName: schema.user.name, contactName: schema.contact.name })
        .from(schema.conversationAccessLog)
        .innerJoin(schema.conversation, eq(schema.conversation.id, schema.conversationAccessLog.conversationId))
        .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
        .leftJoin(schema.user, eq(schema.user.id, schema.conversationAccessLog.userId))
        .where(scoped(schema.conversationAccessLog.organizationId, organizationId, eq(schema.conversation.directNumberId, number.id)))
        .orderBy(desc(schema.conversationAccessLog.viewedAt))
        .limit(50)
    : [];
  const shared = await db
    .select({ access: schema.conversationAccess, ownerName: schema.user.name, contactName: schema.contact.name })
    .from(schema.conversationAccess)
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.conversationAccess.conversationId))
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .innerJoin(schema.directNumber, eq(schema.directNumber.id, schema.conversation.directNumberId))
    .innerJoin(schema.user, eq(schema.user.id, schema.directNumber.userId))
    .where(
      scoped(
        schema.conversationAccess.organizationId,
        organizationId,
        eq(schema.conversationAccess.userId, userId),
        eq(schema.conversationAccess.status, "granted"),
        liveNumber()
      )
    );
  return {
    incoming: onMine
      .filter((r) => r.access.status === "pending")
      .map((r) => ({
        id: r.access.id,
        requesterName: r.userName,
        requesterRole: r.role && SUPERVISOR_ROLES.includes(r.role) ? roleLabel(r.role) : null,
        contactName: r.contactName,
        conversationId: r.access.conversationId,
        requestedAt: r.access.requestedAt.toISOString(),
      })),
    granted: onMine
      .filter((r) => r.access.status === "granted")
      .map((r) => ({
        id: r.access.id,
        userName: r.userName,
        contactName: r.contactName,
        conversationId: r.access.conversationId,
        since: (r.access.decidedAt ?? r.access.requestedAt).toISOString(),
      })),
    views: views.map((v) => ({ userName: v.userName ?? "Alguien que ya no está", contactName: v.contactName, viewedAt: v.log.viewedAt.toISOString() })),
    sharedWithMe: shared.map((s) => ({ conversationId: s.access.conversationId, ownerName: s.ownerName, contactName: s.contactName })),
  };
}

/** El dueño acepta, rechaza o quita un acceso a uno de SUS chats. */
export async function decideAccess(
  organizationId: string,
  userId: string,
  accessId: string,
  action: "accept" | "reject" | "revoke"
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ access: schema.conversationAccess, ownerId: schema.directNumber.userId })
    .from(schema.conversationAccess)
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.conversationAccess.conversationId))
    .innerJoin(schema.directNumber, eq(schema.directNumber.id, schema.conversation.directNumberId))
    .where(scoped(schema.conversationAccess.organizationId, organizationId, eq(schema.conversationAccess.id, accessId)))
    .limit(1);
  // Solo el dueño del número decide; para cualquier otro, no existe.
  if (!row || row.ownerId !== userId) throw new MiNumeroFailure("not_found");
  const from: Access["status"] = action === "revoke" ? "granted" : "pending";
  const to: Access["status"] = action === "accept" ? "granted" : action === "reject" ? "rejected" : "revoked";
  const [changed] = await db
    .update(schema.conversationAccess)
    .set({ status: to, decidedAt: new Date(), decidedBy: userId })
    .where(
      scoped(
        schema.conversationAccess.organizationId,
        organizationId,
        eq(schema.conversationAccess.id, accessId),
        eq(schema.conversationAccess.status, from)
      )
    )
    .returning();
  if (!changed) throw new MiNumeroFailure("not_found");
  notify(organizationId, row.access.conversationId, [userId, row.access.userId]);
}

/**
 * Leer un chat ajeno con acceso concedido: SOLO LECTURA, no lo marca leído y
 * queda en la bitácora del dueño.
 */
export async function sharedChatMessages(organizationId: string, userId: string, conversationId: string) {
  const db = getDb();
  const target = await numberChat(organizationId, conversationId);
  const [granted] = await db
    .select({ id: schema.conversationAccess.id })
    .from(schema.conversationAccess)
    .where(
      scoped(
        schema.conversationAccess.organizationId,
        organizationId,
        and(
          eq(schema.conversationAccess.conversationId, conversationId),
          eq(schema.conversationAccess.userId, userId),
          eq(schema.conversationAccess.status, "granted")
        )
      )
    )
    .limit(1);
  if (!granted) throw new MiNumeroFailure("not_found");
  await db.insert(schema.conversationAccessLog).values({ id: newId("conversationAccessLog"), organizationId, conversationId, userId });
  notify(organizationId, conversationId, [target.number.userId]);
  const rows = await db
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(schema.mediaAsset, eq(schema.message.mediaAssetId, schema.mediaAsset.id))
    .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.conversationId, conversationId)))
    .orderBy(schema.message.createdAt);
  return rows.map((r) => serializeMessage(r.message, r.media));
}

export type { NumberRow };
