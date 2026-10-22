import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { DirectStatusUpdate } from "@/lib/direct-echo";
import { runWithOrganization } from "@/lib/request-context";
import { connectionByWebhookHash } from "@/server/credentials/direct";
import { publish } from "@/server/events/bus";
import { ALLOWED_FROM } from "@/server/inbox/status";
import { orgHasConexionDirecta } from "@/server/modules";
import { hashToken } from "./link";

/**
 * Conexión directa (PR 4) — Palomitas de lo que sale por el dispositivo
 * vinculado. Meta no manda estados de un eco (se ve con una sola palomita),
 * así que el dispositivo (`messages.update`) dice si llegó y si se leyó.
 *
 * Se busca por el ID del dispositivo (`alt_message_id`): el envío directo y,
 * de paso, lo escrito en el celular (su eco guarda ese ID). Mismas reglas
 * que los estados de Meta (`ALLOWED_FROM`): nunca retrocede, y cada hora se
 * guarda una vez.
 */

const TIME_KEY = { sent: "sentAt", delivered: "deliveredAt", read: "readAt" } as const;

export async function applyDirectStatuses(organizationId: string, updates: DirectStatusUpdate[]): Promise<number> {
  const db = getDb();
  let changed = 0;
  for (const u of updates) {
    const at = u.at ?? new Date();
    const byAlt = [eq(schema.message.altMessageId, u.id), eq(schema.message.direction, "out")] as const;
    const rows = await db
      .update(schema.message)
      .set({ status: u.status })
      .where(scoped(schema.message.organizationId, organizationId, ...byAlt, inArray(schema.message.status, ALLOWED_FROM[u.status])))
      .returning({ id: schema.message.id, conversationId: schema.message.conversationId });
    const key = TIME_KEY[u.status];
    await db
      .update(schema.message)
      .set({ [key]: sql`coalesce(${schema.message[key]}, ${at.toISOString()}::timestamp)` })
      .where(scoped(schema.message.organizationId, organizationId, ...byAlt));
    for (const r of rows) {
      changed++;
      publish(organizationId, {
        type: "message.status",
        data: { conversationId: r.conversationId, messageId: r.id, status: u.status },
      });
    }
  }
  return changed;
}

/** El webhook del dispositivo: el token de la URL decide la organización. Sin el complemento no hace nada. */
export async function handleWebhookStatuses(token: string, updates: DirectStatusUpdate[]): Promise<boolean> {
  const row = await connectionByWebhookHash(hashToken(token));
  if (!row) return false;
  if (updates.length === 0 || !(await orgHasConexionDirecta(row.organizationId))) return true;
  await runWithOrganization(row.organizationId, () => applyDirectStatuses(row.organizationId, updates));
  return true;
}
