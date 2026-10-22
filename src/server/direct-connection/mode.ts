import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { type ConnectionMode, type InboxDirectContext } from "@/lib/direct-connection";
import { logger } from "@/lib/log";
import { orgHasWhatsAppConnection } from "@/server/credentials";
import { getConnection } from "@/server/credentials/direct";
import { publish } from "@/server/events/bus";
import { orgHasConexionDirecta } from "@/server/modules";
import { getDirectSettings } from "./settings";

const log = logger("direct-connection");

/**
 * Conexión directa (PR 5) — El modo de cada chat. El dato es UNO solo
 * (`conversation.connection_mode`); NULL = el modo por defecto de la
 * organización. Aquí vive quién puede cambiarlo, cuándo se puede y el regreso
 * automático a Oficial cuando el contacto escribe.
 */

/** Pura: ¿hay dispositivo listo para salir por él? Conectado y sin pausa. */
export function deviceReady(conn: { status: string; pausedUntil: Date | null } | null, now: Date): boolean {
  return !!conn && conn.status === "connected" && !(conn.pausedUntil && conn.pausedUntil > now);
}

/** Lo que la Bandeja necesita saber de la conexión directa de esta organización. */
export async function inboxDirectContext(organizationId: string, canChangeMode: boolean): Promise<InboxDirectContext | null> {
  if (!(await orgHasConexionDirecta(organizationId))) return null;
  const [settings, conn, hasMeta] = await Promise.all([
    getDirectSettings(organizationId),
    getConnection(organizationId),
    orgHasWhatsAppConnection(organizationId),
  ]);
  const now = new Date();
  return {
    // PR 6: sin Meta todo chat es Directa y no hay nada que elegir.
    defaultMode: hasMeta ? settings.defaultMode : "directa",
    canChangeMode: hasMeta && canChangeMode,
    metaless: !hasMeta,
    deviceReady: deviceReady(conn, now),
    paused: !!conn?.pausedUntil && conn.pausedUntil > now,
  };
}

export type SetModeResult = { ok: true; mode: ConnectionMode } | { ok: false; error: "no_device" | "paused" | "not_whatsapp" | "not_found" };

/**
 * Cambia el modo de un chat. Salir de Oficial exige un dispositivo conectado y
 * sin pausa; volver a Oficial siempre se puede. El permiso y el complemento los
 * valida la ruta.
 */
export async function setChatMode(organizationId: string, conversationId: string, mode: ConnectionMode): Promise<SetModeResult> {
  const db = getDb();
  const [conv] = await db
    .select({ id: schema.conversation.id, channel: schema.conversation.channel })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  if (!conv) return { ok: false, error: "not_found" };
  if (conv.channel !== "whatsapp") return { ok: false, error: "not_whatsapp" };
  if (mode !== "meta") {
    const conn = await getConnection(organizationId);
    const now = new Date();
    if (conn?.pausedUntil && conn.pausedUntil > now) return { ok: false, error: "paused" };
    if (!deviceReady(conn, now)) return { ok: false, error: "no_device" };
  }
  await db
    .update(schema.conversation)
    .set({ connectionMode: mode, connectionModeChangedAt: new Date(), updatedAt: new Date() })
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)));
  return { ok: true, mode };
}

/**
 * Cuando el contacto escribe, el chat vuelve a Oficial (si la organización lo
 * tiene encendido, que es lo normal). Solo mira la base si el chat YA está en
 * Directa o Mixta: el resto de los chats no pagan nada. Nunca tumba la entrada
 * del mensaje: si algo falla, se registra y sigue.
 */
export async function autoReturnOnInbound(
  organizationId: string,
  conversation: { id: string; channel: string; connectionMode: string | null }
): Promise<boolean> {
  if (conversation.channel !== "whatsapp") return false;
  if (conversation.connectionMode !== "directa" && conversation.connectionMode !== "mixta") return false;
  try {
    if (!(await orgHasConexionDirecta(organizationId))) return false;
    if (!(await getDirectSettings(organizationId)).autoReturnToMeta) return false;
    // PR 6: sin Meta no hay Oficial a dónde volver.
    if (!(await orgHasWhatsAppConnection(organizationId))) return false;
    const changed = await getDb()
      .update(schema.conversation)
      .set({ connectionMode: "meta", connectionModeChangedAt: new Date() })
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          eq(schema.conversation.id, conversation.id),
          inArray(schema.conversation.connectionMode, ["directa", "mixta"])
        )
      )
      .returning({ id: schema.conversation.id });
    if (changed.length === 0) return false;
    publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversation.id } } });
    return true;
  } catch (err) {
    log.error("no se pudo regresar el chat a Oficial", { org: organizationId, conversacion: conversation.id, err });
    return false;
  }
}
