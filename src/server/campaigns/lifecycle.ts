import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { CampaignStatus } from "@/lib/campaigns";
import { publish } from "@/server/events/bus";
import { recipientCounts } from "@/server/campaigns/queue";

/**
 * Campañas v2 (PR 2) — Transiciones de estado de una campaña. Todas son
 * CONDICIONALES en la BD (`WHERE status IN …`): dos pestañas, dos réplicas o
 * la persona y el despachador a la vez no pueden pisarse; quien pierde la
 * carrera no cambia nada.
 *
 *   draft ─launch→ scheduled ─(hora)→ sending ⇄ paused
 *                       └──────────────→ sending → completed
 *   scheduled | sending | paused ─cancel→ cancelled
 *   sending ─(error interno)→ failed
 */

type Transition = { from: CampaignStatus[]; set: Partial<typeof schema.campaign.$inferInsert> };

export async function transition(organizationId: string, campaignId: string, t: Transition): Promise<boolean> {
  const rows = await getDb()
    .update(schema.campaign)
    .set(t.set)
    .where(
      scoped(
        schema.campaign.organizationId,
        organizationId,
        eq(schema.campaign.id, campaignId),
        inArray(schema.campaign.status, t.from)
      )
    )
    .returning({ id: schema.campaign.id, status: schema.campaign.status });
  if (rows[0]) await publishProgress(organizationId, campaignId, rows[0].status);
  return rows.length > 0;
}

export async function publishProgress(organizationId: string, campaignId: string, status: string): Promise<void> {
  publish(organizationId, {
    type: "campaign.progress",
    data: { campaignId, status, counts: await recipientCounts(organizationId, campaignId) },
  });
}

/** Pausa (a mano o de seguridad). Solo una campaña que envía o espera su hora. */
export function pauseCampaign(
  organizationId: string,
  campaignId: string,
  opts: { reason: string; auto: boolean; resumeAt?: Date | null }
): Promise<boolean> {
  return transition(organizationId, campaignId, {
    from: ["sending", "scheduled"],
    set: { status: "paused", pauseReason: opts.reason.slice(0, 500), autoPaused: opts.auto, resumeAt: opts.resumeAt ?? null },
  });
}

/** Reanuda: vuelve a enviar (o a esperar su hora, si aún no llega). */
export async function resumeCampaign(organizationId: string, campaignId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ scheduledAt: schema.campaign.scheduledAt, startedAt: schema.campaign.startedAt })
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, organizationId, eq(schema.campaign.id, campaignId)))
    .limit(1);
  const c = rows[0];
  if (!c) return false;
  const stillWaiting = !c.startedAt && c.scheduledAt !== null && c.scheduledAt.getTime() > Date.now();
  return transition(organizationId, campaignId, {
    from: ["paused"],
    set: {
      status: stillWaiting ? "scheduled" : "sending",
      pauseReason: null,
      autoPaused: false,
      resumeAt: null,
      startedAt: stillWaiting ? null : (c.startedAt ?? new Date()),
    },
  });
}

/**
 * Cancela: lo que no salió queda `skipped` ("cancelada"). Lo que está en
 * vuelo (ya en Meta) termina normalmente.
 */
export async function cancelCampaign(organizationId: string, campaignId: string): Promise<boolean> {
  const ok = await transition(organizationId, campaignId, {
    from: ["scheduled", "sending", "paused"],
    set: { status: "cancelled", finishedAt: new Date(), pauseReason: null, autoPaused: false, resumeAt: null },
  });
  if (ok) {
    await getDb()
      .update(schema.campaignRecipient)
      .set({ status: "skipped", errorMessage: "La campaña se canceló antes de enviarle" })
      .where(
        scoped(
          schema.campaignRecipient.organizationId,
          organizationId,
          eq(schema.campaignRecipient.campaignId, campaignId),
          eq(schema.campaignRecipient.status, "pending")
        )
      );
    await publishProgress(organizationId, campaignId, "cancelled");
  }
  return ok;
}

/** La hora programada llegó: empieza a enviar. */
export function startScheduled(organizationId: string, campaignId: string): Promise<boolean> {
  return transition(organizationId, campaignId, {
    from: ["scheduled"],
    set: { status: "sending", startedAt: new Date() },
  });
}

export function completeCampaign(organizationId: string, campaignId: string): Promise<boolean> {
  return transition(organizationId, campaignId, {
    from: ["sending"],
    set: { status: "completed", finishedAt: new Date(), error: null },
  });
}

export function failCampaign(organizationId: string, campaignId: string, error: string): Promise<boolean> {
  return transition(organizationId, campaignId, {
    from: ["sending"],
    set: { status: "failed", finishedAt: new Date(), error: error.slice(0, 500) },
  });
}

/** Las pausas automáticas sin resolver (para el aviso de la app). */
export async function autoPausedCampaigns(organizationId: string) {
  return getDb()
    .select({ id: schema.campaign.id, name: schema.campaign.name, pauseReason: schema.campaign.pauseReason, resumeAt: schema.campaign.resumeAt })
    .from(schema.campaign)
    .where(
      scoped(
        schema.campaign.organizationId,
        organizationId,
        and(eq(schema.campaign.status, "paused"), eq(schema.campaign.autoPaused, true))
      )
    )
    .limit(20);
}
