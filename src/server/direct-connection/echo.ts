import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { directIdFromWamid, ECHO_FALLBACK_MS, pickEchoFallback } from "@/lib/direct-echo";
import { DIRECT_TIMEOUT_TEXT, STUCK_SEND_MS } from "@/lib/direct-send";
import { logger } from "@/lib/log";
import { publish } from "@/server/events/bus";
import { orgHasConexionDirecta } from "@/server/modules";

/**
 * Conexión directa (PR 4) — Unir el eco de Meta con lo que salió por el
 * dispositivo vinculado.
 *
 * Lo que una persona manda por la directa le llega a Meta como si se hubiera
 * escrito en el celular, y Meta lo regresa como eco (`smb_message_echoes`)
 * con su propio `wa_message_id`. Sin esto se vería dos veces (la burbuja del
 * envío y un «Celular») y además pausaría la IA como respuesta manual.
 *
 * - Unión EXACTA: el `wamid` del eco trae dentro el ID del dispositivo
 *   (`directIdFromWamid`), que el envío guardó en `alt_message_id`.
 * - Si el eco llega ANTES de que el envío sepa su ID (el dispositivo aún no
 *   contesta), se espera a que termine ese envío del mismo chat (máx. 30 s)
 *   y se vuelve a buscar: el orden de llegada no importa.
 * - Respaldo (sin ID legible, o envío que se agotó sin saber su ID): mismo
 *   chat, mismo tipo y texto, a menos de 2 min (`pickEchoFallback`). Nunca
 *   contradice al ID.
 *
 * Unido = el eco NO crea mensaje, ni lead, ni pausa la IA: la fila del envío
 * se queda con el `wa_message_id` del eco (un reintento de Meta ya no hace
 * nada). Si el envío se había dado por fallido por tiempo, el eco prueba que
 * sí salió: pasa a «enviado».
 *
 * Sin el complemento, nada cambia: el eco entra como siempre.
 */

const log = logger("direct-connection");

/** Cuánto se espera, como mucho, a que termine un envío del mismo chat (20 s del dispositivo + «escribiendo…»). */
export const ECHO_WAIT_MS = 30_000;
const POLL_MS = 500;

export type EchoInput = {
  organizationId: string;
  conversationId: string;
  waMessageId: string;
  type: string;
  text: string | null;
  at: Date;
};

export type EchoJoin =
  /** El eco era de un envío directo (o ya se había procesado): no se registra otra vez. */
  | { joined: true; messageId: string | null }
  /** Es un mensaje escrito en el celular: entra como siempre, con el ID del dispositivo para los estados. */
  | { joined: false; directId: string | null };

type Waits = { waitMs?: number; pollMs?: number };

/** Nunca lanza: si algo falla, el eco entra como siempre (mejor dos burbujas que perder un mensaje). */
export async function joinDirectEcho(input: EchoInput, opts: Waits = {}): Promise<EchoJoin> {
  try {
    if (!(await orgHasConexionDirecta(input.organizationId))) return { joined: false, directId: null };
    return await join(input, opts);
  } catch (err) {
    log.warn("no se pudo unir un eco con la conexión directa; entra como siempre", { org: input.organizationId, err });
    return { joined: false, directId: null };
  }
}

async function join(input: EchoInput, opts: Waits): Promise<EchoJoin> {
  const { organizationId } = input;

  const db = getDb();
  // Un reintento de Meta de un eco ya unido (o ya registrado): nada que hacer.
  const [seen] = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.waMessageId, input.waMessageId)))
    .limit(1);
  if (seen) return { joined: true, messageId: null };

  const directId = directIdFromWamid(input.waMessageId);
  const deadline = Date.now() + (opts.waitMs ?? ECHO_WAIT_MS);
  for (;;) {
    if (directId) {
      const exact = await byDirectId(organizationId, directId);
      if (exact) return attach(input, exact, "id");
    }
    if (!(await sendInFlight(input)) || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, opts.pollMs ?? POLL_MS));
  }

  const candidates = await fallbackCandidates(input);
  const picked = pickEchoFallback({ type: input.type, text: input.text, at: input.at, directId }, candidates);
  if (picked) return attach(input, candidates.find((c) => c.id === picked.id)!, "respaldo");
  return { joined: false, directId };
}

type Row = { id: string; conversationId: string; status: string; altMessageId: string | null };

async function byDirectId(organizationId: string, directId: string): Promise<Row | null> {
  const [row] = await getDb()
    .select({
      id: schema.message.id,
      conversationId: schema.message.conversationId,
      status: schema.message.status,
      altMessageId: schema.message.altMessageId,
    })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.altMessageId, directId),
        eq(schema.message.transport, "directa"),
        eq(schema.message.direction, "out")
      )
    )
    .limit(1);
  return row ?? null;
}

/** ¿Hay un envío directo de este chat esperando la respuesta del dispositivo? */
async function sendInFlight(input: EchoInput): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        input.organizationId,
        eq(schema.message.conversationId, input.conversationId),
        eq(schema.message.transport, "directa"),
        eq(schema.message.direction, "out"),
        eq(schema.message.status, "pending"),
        isNull(schema.message.altMessageId),
        isNull(schema.message.queuedUntil),
        gt(schema.message.sentAt, new Date(Date.now() - STUCK_SEND_MS))
      )
    )
    .limit(1);
  return !!row;
}

/** Envíos directos de este chat cerca de la hora del eco que aún no tienen eco. */
async function fallbackCandidates(input: EchoInput) {
  const at = sql<Date>`coalesce(${schema.message.sentAt}, ${schema.message.createdAt})`;
  const from = new Date(input.at.getTime() - ECHO_FALLBACK_MS).toISOString();
  const to = new Date(input.at.getTime() + ECHO_FALLBACK_MS).toISOString();
  const rows = await getDb()
    .select({
      id: schema.message.id,
      conversationId: schema.message.conversationId,
      type: schema.message.type,
      text: schema.message.text,
      status: schema.message.status,
      altMessageId: schema.message.altMessageId,
      at,
    })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        input.organizationId,
        eq(schema.message.conversationId, input.conversationId),
        eq(schema.message.transport, "directa"),
        eq(schema.message.direction, "out"),
        isNull(schema.message.waMessageId),
        or(
          inArray(schema.message.status, ["sent", "delivered", "read"]),
          // Se agotó el tiempo sin saber si salió: el eco lo dice.
          and(eq(schema.message.status, "failed"), eq(schema.message.error, DIRECT_TIMEOUT_TEXT))
        ),
        sql`${at} between ${from}::timestamp and ${to}::timestamp`
      )
    );
  return rows.map((r) => ({ ...r, at: new Date(r.at) }));
}

async function attach(input: EchoInput, row: Row, how: "id" | "respaldo"): Promise<EchoJoin> {
  const { organizationId } = input;
  const recovered = row.status === "failed";
  const [updated] = await getDb()
    .update(schema.message)
    .set(
      recovered
        ? { waMessageId: input.waMessageId, status: "sent", error: null, errorCode: null, failedAt: null }
        : { waMessageId: input.waMessageId }
    )
    .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.id, row.id), isNull(schema.message.waMessageId)))
    .returning({ id: schema.message.id });
  // Ya tenía su eco (dos ecos para un envío no pasa; si pasa, no se duplica).
  if (!updated) return { joined: true, messageId: row.id };
  log.info("eco de Meta unido a un envío directo", { org: organizationId, msg: row.id, como: how });
  if (recovered) {
    publish(organizationId, {
      type: "message.status",
      data: { conversationId: row.conversationId, messageId: row.id, status: "sent", error: null },
    });
  }
  return { joined: true, messageId: row.id };
}
