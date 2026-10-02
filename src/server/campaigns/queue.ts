import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { emptyCounts, type CampaignCounts } from "@/lib/campaigns";
import { NOT_HEALTH_CODES } from "@/server/campaigns/outcome";

/**
 * Campañas v2 (PR 2) — Operaciones de la cola de envío, en la BD.
 *
 * Varias réplicas del contenedor pueden correr a la vez (despliegue de
 * Coolify). Dos defensas, cada una suficiente para no enviar dos veces:
 *
 * 1. CONCESIÓN por número (`wa_send_lease`): solo la réplica dueña despacha
 *    ese número, así el ritmo es POR NÚMERO. Se renueva cada pocos segundos;
 *    una concesión sin renovar en `LEASE_MS` la puede tomar otra.
 * 2. RECLAMO ATÓMICO por destinatario: `UPDATE … WHERE id = (SELECT … FOR
 *    UPDATE SKIP LOCKED) AND status = 'pending' RETURNING`. Dos despachadores
 *    nunca obtienen la misma fila.
 *
 * Antes de llamar a Meta el destinatario queda `sending` (con `claimed_at`,
 * `claimed_by`) y su mensaje reservado SIN wamid. La recuperación de un
 * reclamo abandonado:
 * - sin mensaje → Meta nunca se llamó: vuelve a `pending`;
 * - mensaje con wamid → salió: `sent`;
 * - mensaje sin wamid → incierto: `failed` "interrumpido; no se reintentó
 *   para no duplicar".
 * Un reclamo cuyo dueño sigue vivo (tiene la concesión del número y la
 * renueva) NUNCA se recupera, aunque sea viejo: puede estar esperando a Meta.
 */

export const INSTANCE_ID = `${hostname().slice(0, 40)}-${process.pid}-${randomBytes(4).toString("hex")}`;

export const LEASE_MS = 30_000;
/** Además de no tener dueño vivo, el reclamo debe tener al menos esta edad. */
export const CLAIM_STALE_MS = 2 * 60_000;

type RecipientRow = typeof schema.campaignRecipient.$inferSelect;

/** Toma (o renueva) la concesión del número. true = esta réplica despacha. */
export async function acquireLease(organizationId: string, phoneNumberId: string, owner = INSTANCE_ID): Promise<boolean> {
  const rows = await getDb()
    .insert(schema.waSendLease)
    .values({ organizationId, phoneNumberId, owner, heartbeatAt: sql`now()` })
    .onConflictDoUpdate({
      target: [schema.waSendLease.organizationId, schema.waSendLease.phoneNumberId],
      set: { owner, heartbeatAt: sql`now()` },
      setWhere: or(
        eq(schema.waSendLease.owner, owner),
        sql`${schema.waSendLease.heartbeatAt} < now() - make_interval(secs => ${LEASE_MS / 1000})`
      ),
    })
    .returning({ owner: schema.waSendLease.owner });
  return rows[0]?.owner === owner;
}

/** Renueva; false = otra réplica se la quedó (esta debe dejar de enviar). */
export async function renewLease(organizationId: string, phoneNumberId: string, owner = INSTANCE_ID): Promise<boolean> {
  const rows = await getDb()
    .update(schema.waSendLease)
    .set({ heartbeatAt: sql`now()` })
    .where(
      scoped(
        schema.waSendLease.organizationId,
        organizationId,
        eq(schema.waSendLease.phoneNumberId, phoneNumberId),
        eq(schema.waSendLease.owner, owner)
      )
    )
    .returning({ owner: schema.waSendLease.owner });
  return rows.length > 0;
}

export async function releaseLease(organizationId: string, phoneNumberId: string, owner = INSTANCE_ID): Promise<void> {
  await getDb()
    .delete(schema.waSendLease)
    .where(
      scoped(
        schema.waSendLease.organizationId,
        organizationId,
        eq(schema.waSendLease.phoneNumberId, phoneNumberId),
        eq(schema.waSendLease.owner, owner)
      )
    );
}

/**
 * Reclama el siguiente destinatario pendiente (y ya sin espera) de la
 * campaña. Atómico: con `SKIP LOCKED` dos despachadores nunca toman el mismo.
 */
export async function claimNext(
  organizationId: string,
  campaignId: string,
  owner = INSTANCE_ID
): Promise<RecipientRow | null> {
  const db = getDb();
  // CTE y no `IN (subconsulta)`: Postgres puede evaluar una subconsulta con
  // LIMIT + FOR UPDATE más de una vez dentro del UPDATE (bloquea una fila y
  // no actualiza ninguna). Con la CTE se evalúa una sola vez.
  const next = db.$with("next").as(
    db
      .select({ id: schema.campaignRecipient.id })
      .from(schema.campaignRecipient)
      .where(
        scoped(
          schema.campaignRecipient.organizationId,
          organizationId,
          eq(schema.campaignRecipient.campaignId, campaignId),
          eq(schema.campaignRecipient.status, "pending"),
          or(isNull(schema.campaignRecipient.nextAttemptAt), lte(schema.campaignRecipient.nextAttemptAt, sql`now()`))
        )
      )
      .orderBy(asc(schema.campaignRecipient.createdAt), asc(schema.campaignRecipient.id))
      .limit(1)
      .for("update", { skipLocked: true })
  );
  const rows = await db
    .with(next)
    .update(schema.campaignRecipient)
    .set({ status: "sending", claimedAt: sql`now()`, claimedBy: owner })
    .from(next)
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        organizationId,
        eq(schema.campaignRecipient.id, next.id),
        eq(schema.campaignRecipient.status, "pending")
      )
    )
    .returning();
  return rows[0] ?? null;
}

/** El mensaje reservado ANTES de llamar a Meta, enlazado al destinatario. */
export async function linkMessage(organizationId: string, recipientId: string, messageId: string): Promise<void> {
  await getDb()
    .update(schema.campaignRecipient)
    .set({ messageId })
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        organizationId,
        eq(schema.campaignRecipient.id, recipientId),
        eq(schema.campaignRecipient.status, "sending")
      )
    );
}

type Finish =
  | { status: "sent"; messageId: string }
  | { status: "failed"; error: string; code: number | null }
  | { status: "skipped"; error: string }
  /** Error transitorio: vuelve a la fila con espera. */
  | { status: "retry"; error: string; code: number | null; delayMs: number }
  /** La campaña se pausó: vuelve a la fila sin gastar intento. */
  | { status: "release" };

/** Cierra el reclamo. Solo toca la fila si sigue `sending` y es de este dueño. */
export async function finishClaim(
  organizationId: string,
  recipient: Pick<RecipientRow, "id" | "attempts">,
  result: Finish,
  owner = INSTANCE_ID
): Promise<void> {
  const unclaim = { claimedAt: null, claimedBy: null };
  const set: Partial<typeof schema.campaignRecipient.$inferInsert> =
    result.status === "sent"
      ? { status: "sent", messageId: result.messageId, sentAt: new Date(), errorMessage: null, errorCode: null }
      : result.status === "failed"
        ? { status: "failed", errorMessage: result.error.slice(0, 500), errorCode: result.code, attempts: recipient.attempts + 1 }
        : result.status === "skipped"
          ? { status: "skipped", errorMessage: result.error.slice(0, 500), ...unclaim }
          : result.status === "retry"
            ? {
                status: "pending",
                errorMessage: result.error.slice(0, 500),
                errorCode: result.code,
                attempts: recipient.attempts + 1,
                nextAttemptAt: new Date(Date.now() + result.delayMs),
                messageId: null,
                ...unclaim,
              }
            : { status: "pending", messageId: null, ...unclaim };
  await getDb()
    .update(schema.campaignRecipient)
    .set(set)
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        organizationId,
        eq(schema.campaignRecipient.id, recipient.id),
        eq(schema.campaignRecipient.status, "sending"),
        eq(schema.campaignRecipient.claimedBy, owner)
      )
    );
}

/**
 * Recupera reclamos abandonados de los números de esta organización (un
 * contenedor murió a mitad). Ver la regla en la cabecera.
 */
export async function recoverAbandoned(organizationId: string): Promise<{ requeued: number; sent: number; failed: number }> {
  const db = getDb();
  const stale = await db
    .select({ r: schema.campaignRecipient, wa: schema.message.waMessageId, msgId: schema.message.id })
    .from(schema.campaignRecipient)
    .innerJoin(
      schema.campaign,
      and(
        eq(schema.campaign.organizationId, schema.campaignRecipient.organizationId),
        eq(schema.campaign.id, schema.campaignRecipient.campaignId)
      )
    )
    .leftJoin(
      schema.message,
      and(
        eq(schema.message.organizationId, schema.campaignRecipient.organizationId),
        eq(schema.message.id, schema.campaignRecipient.messageId)
      )
    )
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        organizationId,
        eq(schema.campaignRecipient.status, "sending"),
        sql`${schema.campaignRecipient.claimedAt} < now() - make_interval(secs => ${CLAIM_STALE_MS / 1000})`,
        // Dueño vivo = tiene la concesión de un número de esta organización y la renueva.
        sql`not exists (
          select 1 from ${schema.waSendLease} l
          where l.organization_id = ${schema.campaignRecipient.organizationId}
            and l.owner = ${schema.campaignRecipient.claimedBy}
            and l.heartbeat_at >= now() - make_interval(secs => ${LEASE_MS / 1000})
        )`
      )
    )
    .limit(1000);

  let requeued = 0;
  let sent = 0;
  let failed = 0;
  for (const { r, wa, msgId } of stale) {
    if (!msgId) {
      const n = await db
        .update(schema.campaignRecipient)
        .set({ status: "pending", claimedAt: null, claimedBy: null })
        .where(
          scoped(
            schema.campaignRecipient.organizationId,
            organizationId,
            eq(schema.campaignRecipient.id, r.id),
            eq(schema.campaignRecipient.status, "sending")
          )
        )
        .returning({ id: schema.campaignRecipient.id });
      requeued += n.length;
    } else if (wa) {
      const n = await db
        .update(schema.campaignRecipient)
        .set({ status: "sent", sentAt: r.claimedAt ?? new Date(), errorMessage: null })
        .where(
          scoped(
            schema.campaignRecipient.organizationId,
            organizationId,
            eq(schema.campaignRecipient.id, r.id),
            eq(schema.campaignRecipient.status, "sending")
          )
        )
        .returning({ id: schema.campaignRecipient.id });
      sent += n.length;
    } else {
      const n = await db
        .update(schema.campaignRecipient)
        .set({
          status: "failed",
          errorMessage: "Interrumpido por un reinicio mientras se enviaba: no se reintentó para no duplicar",
        })
        .where(
          scoped(
            schema.campaignRecipient.organizationId,
            organizationId,
            eq(schema.campaignRecipient.id, r.id),
            eq(schema.campaignRecipient.status, "sending")
          )
        )
        .returning({ id: schema.campaignRecipient.id });
      if (n.length > 0) {
        await db
          .update(schema.message)
          .set({ status: "failed", error: "Envío interrumpido: no se sabe si llegó" })
          .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.id, msgId), isNull(schema.message.waMessageId)));
      }
      failed += n.length;
    }
  }
  return { requeued, sent, failed };
}

/** Conteo por estado del destinatario. */
export async function recipientCounts(organizationId: string, campaignId: string): Promise<CampaignCounts> {
  const rows = await getDb()
    .select({ status: schema.campaignRecipient.status, n: sql<number>`count(*)::int` })
    .from(schema.campaignRecipient)
    .where(scoped(schema.campaignRecipient.organizationId, organizationId, eq(schema.campaignRecipient.campaignId, campaignId)))
    .groupBy(schema.campaignRecipient.status);
  const counts = emptyCounts();
  for (const r of rows) counts[r.status] = Number(r.n);
  return counts;
}

/** ¿Le queda algo por hacer a la campaña? (pendientes o en vuelo). */
export async function hasWorkLeft(organizationId: string, campaignId: string): Promise<{ ready: boolean; any: boolean }> {
  const rows = await getDb()
    .select({
      any: sql<number>`count(*)::int`,
      ready: sql<number>`count(*) filter (where ${schema.campaignRecipient.status} = 'pending' and (${schema.campaignRecipient.nextAttemptAt} is null or ${schema.campaignRecipient.nextAttemptAt} <= now()))::int`,
    })
    .from(schema.campaignRecipient)
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        organizationId,
        eq(schema.campaignRecipient.campaignId, campaignId),
        inArray(schema.campaignRecipient.status, ["pending", "sending"])
      )
    );
  return { ready: Number(rows[0]?.ready ?? 0) > 0, any: Number(rows[0]?.any ?? 0) > 0 };
}

/**
 * Los últimos intentos de la campaña que hablan de la salud del número (para
 * la pausa por tasa de fallos), del más nuevo al más viejo.
 */
export async function recentOutcomes(
  organizationId: string,
  campaignId: string,
  limit: number
): Promise<{ failed: boolean }[]> {
  const rows = await getDb()
    .select({ status: schema.campaignRecipient.status })
    .from(schema.campaignRecipient)
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        organizationId,
        eq(schema.campaignRecipient.campaignId, campaignId),
        inArray(schema.campaignRecipient.status, ["sent", "failed"]),
        or(isNull(schema.campaignRecipient.errorCode), notInArray(schema.campaignRecipient.errorCode, [...NOT_HEALTH_CODES])),
        // Un fallo sin código de Meta (contacto borrado, error interno) no habla del número.
        or(eq(schema.campaignRecipient.status, "sent"), isNotNull(schema.campaignRecipient.errorCode))
      )
    )
    .orderBy(desc(sql`coalesce(${schema.campaignRecipient.sentAt}, ${schema.campaignRecipient.claimedAt}, ${schema.campaignRecipient.createdAt})`))
    .limit(limit);
  return rows.map((r) => ({ failed: r.status === "failed" }));
}
