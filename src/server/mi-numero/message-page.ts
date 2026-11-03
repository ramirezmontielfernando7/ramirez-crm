import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { serializeMessage } from "@/server/inbox/ingest";

/**
 * Auditoría DF-15 — El historial de un chat de «Mi número» se lee por
 * bloques: los últimos `MESSAGE_PAGE` mensajes y, al subir, los anteriores
 * (cursor = id del más viejo que ya tiene la pantalla; el orden lo pone la
 * base con su fecha de registro). Antes se leía el chat completo en cada
 * apertura y cada aviso.
 */
export const MESSAGE_PAGE = 200;

export type MessageCursor = { id: string };

/** `?before=<id del mensaje más viejo en pantalla>` de la URL, o null. */
export function messageCursorFrom(url: string | URL): MessageCursor | null {
  const u = typeof url === "string" ? new URL(url) : url;
  const id = u.searchParams.get("before");
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? { id } : null;
}

/** Un bloque del hilo, en orden cronológico (el más viejo primero). */
export async function messagePage(organizationId: string, conversationId: string, cursor: MessageCursor | null = null, limit = MESSAGE_PAGE) {
  const m = schema.message;
  const rows = await getDb()
    .select({ message: m, media: schema.mediaAsset })
    .from(m)
    .leftJoin(schema.mediaAsset, eq(m.mediaAssetId, schema.mediaAsset.id))
    .where(
      scoped(
        m.organizationId,
        organizationId,
        eq(m.conversationId, conversationId),
        // Lo anterior al mensaje del cursor (del MISMO chat; si no existe, nada).
        cursor
          ? sql`(${m.createdAt}, ${m.id}) < (
              select c.created_at, c.id from message c
              where c.organization_id = ${organizationId} and c.conversation_id = ${conversationId} and c.id = ${cursor.id}
            )`
          : undefined
      )
    )
    .orderBy(desc(m.createdAt), desc(m.id))
    .limit(limit);
  return rows.reverse().map((r) => serializeMessage(r.message, r.media));
}
