import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { parseMessagingLimit } from "@/lib/phone-health";
import { runWithOrganization } from "@/lib/request-context";
import { resolveVariables, type CampaignSettingsDto, type CampaignVariable } from "@/lib/campaigns";
import { isOrgActive } from "@/server/platform-admin/org-status";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { sendTemplate } from "@/server/whatsapp/templates";
import { getHealthSummary } from "@/server/whatsapp/health";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { campaignSendRate, campaignsEnabled } from "@/server/campaigns/flag";
import { getCampaignSettings } from "@/server/campaigns/settings";
import { classifySendError, MAX_ATTEMPTS, backoffScale, retryDelayMs } from "@/server/campaigns/outcome";
import { safetyCheck, type SafetyPause } from "@/server/campaigns/safety";
import {
  acquireLease,
  claimNext,
  finishClaim,
  hasWorkLeft,
  INSTANCE_ID,
  linkMessage,
  recentOutcomes,
  recoverAbandoned,
  releaseLease,
  renewLease,
} from "@/server/campaigns/queue";
import {
  completeCampaign,
  pauseCampaign,
  publishProgress,
  resumeCampaign,
  startScheduled,
} from "@/server/campaigns/lifecycle";

const log = logger("campaign");

/**
 * Campañas v2 (PR 2) — Envío en segundo plano, DENTRO del proceso (sin colas
 * externas, Constitución II), con UNA cola POR NÚMERO.
 *
 * - Un despachador por (organización, número) atiende por turnos a TODAS las
 *   campañas activas de ese número, al ritmo de la organización
 *   (`campaignSendRate`). Dos campañas a la vez no duplican el ritmo.
 * - Solo despacha la réplica con la concesión del número (`queue.ts`), y
 *   cada destinatario se reclama de forma atómica.
 * - Justo antes de enviar se re-lee el contacto: si se dio de baja, se
 *   archivó o se borró desde el lanzamiento, NO se le envía (`skipped`).
 * - Errores transitorios: reintento con espera creciente (`outcome.ts`).
 *   131049 no se reintenta.
 * - Pausa de seguridad automática (`safety.ts`) con el motivo, visible en la
 *   app para Propietario y Coordinador.
 * - Reanudable: el programador (`campaignSchedulerTick`, cada 15 s y al
 *   arrancar) arranca las programadas, reanuda las pausas por límite cuando
 *   toca y se asegura de que cada número con campañas activas tenga su
 *   despachador.
 */

const HEARTBEAT_MS = 10_000;
const SAFETY_EVERY_MS = 10_000;
const HEALTH_CACHE_MS = 30_000;
const PROGRESS_EVERY_MS = 1_000;
const DEFAULT_TICK_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

type CampaignRow = typeof schema.campaign.$inferSelect;
type RecipientRow = typeof schema.campaignRecipient.$inferSelect;

export type SendResult =
  | { kind: "sent" }
  | { kind: "skipped" }
  | { kind: "failed" }
  | { kind: "retry"; rateLimit: boolean }
  | { kind: "pause"; reason: string };

export type SendFn = (organizationId: string, campaign: CampaignRow, recipient: RecipientRow, owner: string) => Promise<SendResult>;

/** Envía a UN destinatario ya reclamado y cierra su reclamo. */
export const sendRecipient: SendFn = async (organizationId, campaign, recipient, owner) => {
  const db = getDb();
  const contacts = recipient.contactId
    ? await db
        .select()
        .from(schema.contact)
        .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, recipient.contactId)))
        .limit(1)
    : [];
  const contact = contacts[0];
  // Re-verificación de última hora: la regla dura se cumple AL ENVIAR.
  if (!contact) {
    await finishClaim(organizationId, recipient, { status: "skipped", error: "El contacto fue eliminado antes del envío" }, owner);
    return { kind: "skipped" };
  }
  if (contact.waConsent !== "opt_in") {
    await finishClaim(
      organizationId,
      recipient,
      {
        status: "skipped",
        error:
          contact.waConsent === "opt_out"
            ? "Se dio de baja (opt_out) antes del envío: no se le envió"
            : "Ya no tiene consentimiento (opt_in) al momento del envío: no se le envió",
      },
      owner
    );
    return { kind: "skipped" };
  }
  if (contact.archivedAt) {
    await finishClaim(organizationId, recipient, { status: "skipped", error: "El contacto se archivó antes del envío" }, owner);
    return { kind: "skipped" };
  }

  const variables =
    recipient.variables ?? resolveVariables(campaign.variables as CampaignVariable[], contact.name);
  try {
    const conversation = await getOrCreateConversation(organizationId, contact.id);
    const { messageId } = await sendTemplate({
      organizationId,
      conversationId: conversation.id,
      templateId: campaign.templateId,
      variables,
      reserve: (id) => linkMessage(organizationId, recipient.id, id),
    });
    await finishClaim(organizationId, recipient, { status: "sent", messageId }, owner);
    return { kind: "sent" };
  } catch (err) {
    const d = classifySendError(err);
    if (d.kind === "pause") {
      await finishClaim(organizationId, recipient, { status: "release" }, owner);
      return { kind: "pause", reason: d.reason };
    }
    if (d.kind === "retry") {
      if (recipient.attempts + 1 >= MAX_ATTEMPTS) {
        await finishClaim(
          organizationId,
          recipient,
          { status: "failed", error: `${d.reason}; se intentó ${MAX_ATTEMPTS} veces`, code: d.code },
          owner
        );
        return { kind: "failed" };
      }
      await finishClaim(
        organizationId,
        recipient,
        { status: "retry", error: d.reason, code: d.code, delayMs: retryDelayMs(recipient.attempts + 1) },
        owner
      );
      return { kind: "retry", rateLimit: d.rateLimit };
    }
    await finishClaim(organizationId, recipient, { status: "failed", error: d.reason, code: d.code }, owner);
    return { kind: "failed" };
  }
};

async function activeCampaigns(organizationId: string, phoneNumberId: string): Promise<CampaignRow[]> {
  return getDb()
    .select()
    .from(schema.campaign)
    .where(
      scoped(
        schema.campaign.organizationId,
        organizationId,
        eq(schema.campaign.status, "sending"),
        eq(schema.campaign.phoneNumberId, phoneNumberId)
      )
    )
    .orderBy(schema.campaign.startedAt, schema.campaign.id);
}

/** Pausa todas las campañas activas del número (organización suspendida, módulo apagado). */
async function pauseAll(organizationId: string, phoneNumberId: string, reason: string): Promise<void> {
  for (const c of await activeCampaigns(organizationId, phoneNumberId)) {
    await pauseCampaign(organizationId, c.id, { reason, auto: true });
  }
}

type Health = { quality: string | null; accountEvent: Record<string, unknown> | null; usage: number; limit: number | null };

async function readHealth(organizationId: string): Promise<Health> {
  const h = await getHealthSummary(organizationId);
  return {
    quality: h.today?.qualityRating ?? null,
    accountEvent: h.today?.accountEvent ?? null,
    usage: h.usage,
    limit: h.today?.messagingLimitValue ?? parseMessagingLimit(h.today?.messagingLimit ?? null),
  };
}

export type DispatchOptions = {
  owner?: string;
  send?: SendFn;
  /** Para pruebas: se detiene tras este número de envíos. */
  maxSends?: number;
};

/**
 * El despachador de un número. Corre mientras tenga la concesión y haya
 * campañas activas en ese número; luego la suelta.
 */
export async function dispatchNumber(
  organizationId: string,
  phoneNumberId: string,
  opts: DispatchOptions = {}
): Promise<{ sends: number; lease: boolean }> {
  const owner = opts.owner ?? INSTANCE_ID;
  const send = opts.send ?? sendRecipient;
  if (!(await acquireLease(organizationId, phoneNumberId, owner))) return { sends: 0, lease: false };

  let lost = false;
  const heartbeat = setInterval(() => {
    void renewLease(organizationId, phoneNumberId, owner).then(
      (ok) => {
        if (!ok) lost = true;
      },
      (err: unknown) => log.error("no se pudo renovar la concesión del número", { org: organizationId, err })
    );
  }, HEARTBEAT_MS);

  let sends = 0;
  try {
    const recovered = await recoverAbandoned(organizationId);
    if (recovered.requeued + recovered.sent + recovered.failed > 0) {
      log.info("reclamos abandonados recuperados", { org: organizationId, ...recovered });
    }
    const minIntervalMs = 1000 / (await campaignSendRate(organizationId));
    let settings: CampaignSettingsDto = await getCampaignSettings(organizationId);
    let health: Health | null = null;
    let healthAt = 0;
    let settingsAt = Date.now();
    let cooldownUntil = 0;
    let rr = 0;
    const lastSafety = new Map<string, number>();
    const lastProgress = new Map<string, number>();
    const idle = new Set<string>();

    for (;;) {
      if (lost) break;
      if (opts.maxSends !== undefined && sends >= opts.maxSends) break;
      // Fase 3: nada sale de una organización suspendida ni por un módulo apagado.
      if (!(await isOrgActive(organizationId))) {
        await pauseAll(organizationId, phoneNumberId, "Se pausó: la organización fue suspendida por la plataforma");
        break;
      }
      if (!(await campaignsEnabled(organizationId))) {
        await pauseAll(organizationId, phoneNumberId, "Se pausó: Campañas se apagó para esta organización");
        break;
      }
      const campaigns = await activeCampaigns(organizationId, phoneNumberId);
      if (campaigns.length === 0) break;
      if (idle.size >= campaigns.length) {
        // Todas esperan un reintento: no girar en vacío.
        idle.clear();
        await sleep(1000 * Math.max(backoffScale(), 0.05));
        continue;
      }
      const campaign = campaigns[rr++ % campaigns.length]!;
      if (idle.has(campaign.id)) continue;

      const now = Date.now();
      if (now - settingsAt > 60_000) {
        settings = await getCampaignSettings(organizationId);
        settingsAt = now;
      }
      if (now - (lastSafety.get(campaign.id) ?? 0) >= SAFETY_EVERY_MS) {
        lastSafety.set(campaign.id, now);
        if (!health || now - healthAt > HEALTH_CACHE_MS) {
          health = await readHealth(organizationId);
          healthAt = now;
        }
        const pause = await checkSafety(organizationId, campaign.id, settings, health);
        if (pause) {
          await pauseCampaign(organizationId, campaign.id, { reason: pause.reason, auto: true, resumeAt: pause.resumeAt });
          log.warn("pausa de seguridad", { org: organizationId, campana: campaign.id, motivo: pause.reason });
          continue;
        }
      }

      if (Date.now() < cooldownUntil) await sleep(cooldownUntil - Date.now());
      const recipient = await claimNext(organizationId, campaign.id, owner);
      if (!recipient) {
        const left = await hasWorkLeft(organizationId, campaign.id);
        if (!left.any) await completeCampaign(organizationId, campaign.id);
        else idle.add(campaign.id);
        continue;
      }
      idle.clear();

      const startedAt = Date.now();
      const result = await send(organizationId, campaign, recipient, owner);
      sends++;
      if (result.kind === "pause") {
        await pauseCampaign(organizationId, campaign.id, { reason: result.reason, auto: true });
        log.warn("campaña pausada por un error que afecta a todos", { org: organizationId, campana: campaign.id, motivo: result.reason });
        continue;
      }
      if (result.kind === "retry" && result.rateLimit) {
        // Meta pidió bajar el ritmo DEL NÚMERO: frena a todas sus campañas.
        cooldownUntil = Date.now() + retryDelayMs(1);
      }
      if (Date.now() - (lastProgress.get(campaign.id) ?? 0) >= PROGRESS_EVERY_MS) {
        lastProgress.set(campaign.id, Date.now());
        await publishProgress(organizationId, campaign.id, "sending");
      }
      await sleep(minIntervalMs - (Date.now() - startedAt));
    }
  } finally {
    clearInterval(heartbeat);
    await releaseLease(organizationId, phoneNumberId, owner);
  }
  return { sends, lease: true };
}

/** ¿Hay que pausar esta campaña? (tasa de fallos, calidad, cuenta, uso del límite). */
export async function checkSafety(
  organizationId: string,
  campaignId: string,
  settings: CampaignSettingsDto,
  health: Health
): Promise<SafetyPause | null> {
  const recent = await recentOutcomes(organizationId, campaignId, settings.failRateWindow);
  return safetyCheck({ settings, recent, ...health });
}

const globalForDispatch = globalThis as unknown as {
  __voceroDispatchers?: Map<string, Promise<unknown>>;
  __voceroCampaignScheduler?: NodeJS.Timeout;
};
function running(): Map<string, Promise<unknown>> {
  globalForDispatch.__voceroDispatchers ??= new Map();
  return globalForDispatch.__voceroDispatchers;
}

/** Arranca el despachador del número si esta réplica no lo tiene ya. */
export function ensureDispatcher(organizationId: string, phoneNumberId: string): void {
  const key = `${organizationId}:${phoneNumberId}`;
  if (running().has(key)) return;
  const p = runWithOrganization(organizationId, () => dispatchNumber(organizationId, phoneNumberId))
    .catch((err: unknown) => {
      // Las campañas siguen `sending`: el siguiente pulso del programador lo reintenta.
      log.error("el despachador del número se detuvo por un error", { org: organizationId, numero: phoneNumberId, err });
    })
    .finally(() => running().delete(key));
  running().set(key, p);
}

/**
 * Un pulso del programador. La lista sale del pool de sistema (cruza
 * organizaciones); el trabajo de cada una corre a nombre de ELLA.
 */
export async function campaignSchedulerTick(): Promise<void> {
  const now = new Date();
  const rows = await getSystemDb()
    .selectDistinct({ organizationId: schema.campaign.organizationId })
    .from(schema.campaign)
    .where(
      or(
        eq(schema.campaign.status, "sending"),
        and(eq(schema.campaign.status, "scheduled"), lte(schema.campaign.scheduledAt, now)),
        and(eq(schema.campaign.status, "paused"), eq(schema.campaign.autoPaused, true), lte(schema.campaign.resumeAt, now))
      )
    );
  for (const { organizationId } of rows) {
    try {
      // Fase 3, PR 3: con Campañas apagadas para esa organización se quedan
      // quietas; si se vuelve a encender, el siguiente pulso las retoma.
      if (!(await campaignsEnabled(organizationId)) || !(await isOrgActive(organizationId))) continue;
      await runWithOrganization(organizationId, () => tickOrganization(organizationId, now));
    } catch (err) {
      log.error("el programador de campañas falló para una organización", { org: organizationId, err });
    }
  }
}

async function tickOrganization(organizationId: string, now: Date): Promise<void> {
  const db = getDb();
  const due = await db
    .select({ id: schema.campaign.id, status: schema.campaign.status })
    .from(schema.campaign)
    .where(
      scoped(
        schema.campaign.organizationId,
        organizationId,
        or(
          and(eq(schema.campaign.status, "scheduled"), lte(schema.campaign.scheduledAt, now)),
          and(eq(schema.campaign.status, "paused"), eq(schema.campaign.autoPaused, true), lte(schema.campaign.resumeAt, now))
        )
      )
    );
  for (const c of due) {
    if (c.status === "scheduled") await startScheduled(organizationId, c.id);
    else await resumeCampaign(organizationId, c.id);
  }

  // Campañas lanzadas por la versión anterior no tienen número: el de la organización.
  const creds = await getCredentialsByOrg(organizationId);
  if (creds) {
    await db
      .update(schema.campaign)
      .set({ phoneNumberId: creds.phoneNumberId })
      .where(
        scoped(
          schema.campaign.organizationId,
          organizationId,
          inArray(schema.campaign.status, ["sending", "paused", "scheduled"]),
          isNull(schema.campaign.phoneNumberId)
        )
      );
  }
  const phones = await db
    .selectDistinct({ phoneNumberId: schema.campaign.phoneNumberId })
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, organizationId, eq(schema.campaign.status, "sending")));
  for (const p of phones) {
    if (p.phoneNumberId) ensureDispatcher(organizationId, p.phoneNumberId);
  }
}

function tickMs(): number {
  const n = Number(process.env.CAMPAIGN_TICK_MS ?? "");
  return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_TICK_MS;
}

/** Al arrancar el servidor: un pulso inmediato y luego cada 15 s. */
export function startCampaignScheduler(): void {
  if (globalForDispatch.__voceroCampaignScheduler) return;
  const run = async () => {
    try {
      await campaignSchedulerTick();
    } catch (err) {
      log.error("el programador de campañas falló", { err });
    }
  };
  void run();
  globalForDispatch.__voceroCampaignScheduler = setInterval(() => void run(), tickMs());
}
