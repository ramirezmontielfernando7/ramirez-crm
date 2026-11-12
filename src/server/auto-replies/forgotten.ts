import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { companyChat, scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";
import { FORGOTTEN_MAX_AGE_HOURS, isWithinBusinessHours } from "@/lib/auto-replies";
import { publish } from "@/server/events/bus";
import { autoSettingsFromRow } from "@/server/auto-replies/settings";

const log = logger("olvidados");

/** Cuántos avisos como máximo por organización en una pasada (un día de atraso no inunda a nadie). */
const MAX_PER_PASS = 20;

/** Organizaciones ACTIVAS con el aviso encendido (pool de sistema: cruza organizaciones). */
async function orgsWithAlert(): Promise<string[]> {
  const rows = await getSystemDb()
    .select({ id: schema.messagingSettings.organizationId })
    .from(schema.messagingSettings)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.messagingSettings.organizationId))
    .where(and(eq(schema.organization.status, "active"), isNotNull(schema.messagingSettings.forgottenAlertHours)));
  return rows.map((r) => r.id);
}

/**
 * 049 — Avisa de los chats que un cliente dejó sin respuesta. «Sin respuesta»
 * = ningún mensaje de una persona o de la IA después de lo último que dijo el
 * cliente (los automáticos de bienvenida / fuera de horario NO cuentan).
 * Un solo aviso por mensaje del cliente (`forgotten_alerted_at`) y solo
 * dentro del horario del negocio. El aviso es el mismo toast de «atención
 * humana» (`handoff.requested`, motivo `olvidado`): le llega al asesor
 * asignado y a quien ve todo.
 */
export async function runForgottenChatsForOrg(organizationId: string, now = new Date()): Promise<number> {
  const [row] = await getDb()
    .select()
    .from(schema.messagingSettings)
    .where(scoped(schema.messagingSettings.organizationId, organizationId))
    .limit(1);
  const settings = autoSettingsFromRow(row);
  const threshold = settings.forgottenAlertHours;
  if (!threshold) return 0;
  if (!isWithinBusinessHours(now, settings.hours, settings.timezone)) return 0;

  const waitedEnough = new Date(now.getTime() - threshold * 3_600_000);
  const tooOld = new Date(now.getTime() - FORGOTTEN_MAX_AGE_HOURS * 3_600_000);
  const rows = await getDb()
    .select({
      conversationId: schema.conversation.id,
      contactId: schema.contact.id,
      contactName: schema.contact.name,
      assignedUserId: schema.contact.assignedUserId,
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        and(
          companyChat(),
          eq(schema.conversation.channel, "whatsapp"),
          isNull(schema.conversation.archivedAt),
          isNull(schema.contact.archivedAt),
          isNotNull(schema.conversation.lastInboundAt),
          lt(schema.conversation.lastInboundAt, waitedEnough),
          gt(schema.conversation.lastInboundAt, tooOld),
          or(
            isNull(schema.conversation.forgottenAlertedAt),
            sql`${schema.conversation.forgottenAlertedAt} < ${schema.conversation.lastInboundAt}`
          ),
          sql`not exists (
            select 1 from ${schema.message} m
            where m.conversation_id = ${schema.conversation.id}
              and m.organization_id = ${schema.conversation.organizationId}
              and m.direction = 'out'
              and m.auto_kind is null
              and m.status <> 'failed'
              and m.created_at >= ${schema.conversation.lastInboundAt}
          )`
        )
      )
    )
    .orderBy(schema.conversation.lastInboundAt)
    .limit(MAX_PER_PASS);

  let sent = 0;
  for (const r of rows) {
    // Se marca primero: dos pasadas a la vez no avisan dos veces.
    const claimed = await getDb()
      .update(schema.conversation)
      .set({ forgottenAlertedAt: now })
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          and(
            eq(schema.conversation.id, r.conversationId),
            or(
              isNull(schema.conversation.forgottenAlertedAt),
              sql`${schema.conversation.forgottenAlertedAt} < ${schema.conversation.lastInboundAt}`
            )
          )
        )
      )
      .returning({ id: schema.conversation.id });
    if (claimed.length === 0) continue;
    publish(organizationId, {
      type: "handoff.requested",
      data: {
        conversationId: r.conversationId,
        contactId: r.contactId,
        contactName: r.contactName,
        reason: "olvidado",
        assignedUserId: r.assignedUserId,
      },
    });
    sent += 1;
  }
  return sent;
}

export async function runForgottenChatsCheck(now = new Date()): Promise<number> {
  let total = 0;
  for (const org of await orgsWithAlert()) {
    try {
      total += await runWithOrganization(org, () => runForgottenChatsForOrg(org, now));
    } catch (err) {
      log.error("falló la revisión de chats olvidados de una organización", { org, err });
    }
  }
  return total;
}

const EVERY_MS = 5 * 60 * 1000;
const globalForForgotten = globalThis as unknown as { __voceroForgotten?: NodeJS.Timeout };

/** Cada 5 minutos (la primera pasada, un minuto después de arrancar). */
export function startForgottenChatsCheck(): void {
  if (globalForForgotten.__voceroForgotten) return;
  const run = async () => {
    try {
      const n = await runForgottenChatsCheck();
      if (n > 0) log.info(`avisos de chats olvidados: ${n}`);
    } catch (err) {
      log.error("la revisión de chats olvidados falló", { err });
    }
  };
  setTimeout(() => void run(), 60_000).unref();
  globalForForgotten.__voceroForgotten = setInterval(() => void run(), EVERY_MS);
  globalForForgotten.__voceroForgotten.unref();
}
