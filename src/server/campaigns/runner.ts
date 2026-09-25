import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { resolveVariables, type CampaignVariable } from "@/lib/campaigns";
import { publish } from "@/server/events/bus";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { SendError } from "@/server/inbox/send";
import { sendTemplate, TemplateError } from "@/server/whatsapp/templates";
import { campaignSendRate } from "@/server/campaigns/flag";

/**
 * 021 — Ejecutor de campañas: envío en segundo plano, DENTRO del proceso
 * (sin colas externas, Constitución II), igual que el Laboratorio.
 *
 * - Un destinatario a la vez, a `CAMPAIGN_SEND_RATE` mensajes/segundo.
 * - Cada envío pasa por `sendTemplate()` — la misma llamada a Meta que el
 *   envío individual —, sobre la conversación del contacto (creada si no
 *   existía, como en "Iniciar conversación").
 * - Justo antes de enviar se re-lee el contacto: si se dio de baja (opt_out),
 *   se archivó o se borró desde que se lanzó la campaña, NO se le envía.
 * - Límite de ritmo de Meta (130429, 80007…): pausa con espera creciente y
 *   reintenta al MISMO destinatario; no lo marca como fallido.
 * - Fallos que afectan a todos (token vencido, plantilla pausada o que dejó
 *   de coincidir): la campaña se detiene (`failed`) con el motivo, y los
 *   pendientes quedan pendientes: nunca se "queman" cientos de envíos.
 * - Reanudable: al arrancar el servidor, las campañas en `sending` siguen
 *   con sus pendientes (`resumeCampaigns`). El índice único
 *   (campaña, contacto) y el estado por fila impiden enviar dos veces.
 */

/** Límite de ritmo / throughput: pausar y reintentar. */
const RATE_LIMIT_CODES = new Set([4, 80007, 130429]);
/** Meta frenó el número por calidad: seguir empeora la reputación. */
const QUALITY_STOP_CODES = new Set([131048]);
/** La plantilla dejó de servir: fallaría con todos. */
const TEMPLATE_STOP_CODES = new Set([132000, 132001, 132005, 132007, 132012, 132015, 132016]);

const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
const UNAVAILABLE_BACKOFF_MS = [3_000, 10_000, 30_000];

/** En pruebas el reloj se acorta: nadie espera 2 minutos a un test. */
function backoffScale(): number {
  const n = Number(process.env.CAMPAIGN_BACKOFF_SCALE ?? "");
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

const globalForRunners = globalThis as unknown as { __voceroCampaignRunners?: Set<string> };
function running(): Set<string> {
  globalForRunners.__voceroCampaignRunners ??= new Set();
  return globalForRunners.__voceroCampaignRunners;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class StopCampaign extends Error {}

/** Arranca el ejecutor si no está corriendo ya para esa campaña. */
export function startCampaignRunner(organizationId: string, campaignId: string): void {
  if (running().has(campaignId)) return;
  running().add(campaignId);
  void executeCampaign(organizationId, campaignId)
    .catch(async (err) => {
      console.error(`[campaign] ${campaignId} falló:`, err);
      await finishCampaign(organizationId, campaignId, "failed", "Error interno del envío; revisa los registros del servidor").catch(
        (e) => console.error(`[campaign] ${campaignId} no se pudo marcar como fallida:`, e)
      );
    })
    .finally(() => running().delete(campaignId));
}

/** Al arrancar el servidor: reanuda las campañas que quedaron enviando. */
export async function resumeCampaigns(): Promise<number> {
  const rows = await getDb()
    .select({ id: schema.campaign.id, organizationId: schema.campaign.organizationId })
    .from(schema.campaign)
    .where(eq(schema.campaign.status, "sending"));
  for (const r of rows) startCampaignRunner(r.organizationId, r.id);
  return rows.length;
}

async function progress(organizationId: string, campaignId: string, status: string) {
  const rows = await getDb()
    .select({ status: schema.campaignRecipient.status, n: sql<number>`count(*)::int` })
    .from(schema.campaignRecipient)
    .where(eq(schema.campaignRecipient.campaignId, campaignId))
    .groupBy(schema.campaignRecipient.status);
  const counts = { pending: 0, sent: 0, failed: 0 };
  for (const r of rows) counts[r.status] = Number(r.n);
  publish(organizationId, { type: "campaign.progress", data: { campaignId, status, counts } });
}

async function finishCampaign(
  organizationId: string,
  campaignId: string,
  status: "completed" | "failed",
  error: string | null
) {
  await getDb()
    .update(schema.campaign)
    .set({ status, error, finishedAt: new Date() })
    .where(and(eq(schema.campaign.id, campaignId), eq(schema.campaign.organizationId, organizationId)));
  await progress(organizationId, campaignId, status);
}

async function markRecipient(
  recipientId: string,
  result: { status: "sent"; messageId: string } | { status: "failed"; error: string }
) {
  await getDb()
    .update(schema.campaignRecipient)
    .set(
      result.status === "sent"
        ? { status: "sent", messageId: result.messageId, sentAt: new Date(), errorMessage: null }
        : { status: "failed", errorMessage: result.error.slice(0, 500) }
    )
    .where(and(eq(schema.campaignRecipient.id, recipientId), eq(schema.campaignRecipient.status, "pending")));
}

async function executeCampaign(organizationId: string, campaignId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaign)
    .where(and(eq(schema.campaign.id, campaignId), eq(schema.campaign.organizationId, organizationId)))
    .limit(1);
  const campaign = rows[0];
  if (!campaign || campaign.status !== "sending") return;
  const variables = campaign.variables as CampaignVariable[];
  const minIntervalMs = 1000 / campaignSendRate();

  await progress(organizationId, campaignId, "sending");
  let lastProgressAt = Date.now();

  try {
    for (;;) {
      const batch = await db
        .select({ recipient: schema.campaignRecipient, contact: schema.contact })
        .from(schema.campaignRecipient)
        .leftJoin(schema.contact, eq(schema.contact.id, schema.campaignRecipient.contactId))
        .where(
          and(
            eq(schema.campaignRecipient.campaignId, campaignId),
            eq(schema.campaignRecipient.status, "pending")
          )
        )
        .orderBy(asc(schema.campaignRecipient.createdAt), asc(schema.campaignRecipient.id))
        .limit(100);
      if (batch.length === 0) break;

      for (const { recipient, contact } of batch) {
        const startedAt = Date.now();
        await sendOne(organizationId, campaign.templateId, variables, recipient, contact);
        if (Date.now() - lastProgressAt > 1000) {
          await progress(organizationId, campaignId, "sending");
          lastProgressAt = Date.now();
        }
        const wait = minIntervalMs - (Date.now() - startedAt);
        if (wait > 0) await sleep(wait);
      }
    }
  } catch (err) {
    if (err instanceof StopCampaign) {
      await finishCampaign(organizationId, campaignId, "failed", err.message);
      return;
    }
    throw err;
  }
  await finishCampaign(organizationId, campaignId, "completed", null);
}

type RecipientRow = typeof schema.campaignRecipient.$inferSelect;
type ContactRow = typeof schema.contact.$inferSelect;

async function sendOne(
  organizationId: string,
  templateId: string,
  variables: CampaignVariable[],
  recipient: RecipientRow,
  contact: ContactRow | null
): Promise<void> {
  // Re-verificación de última hora: la regla dura se cumple AL ENVIAR.
  if (!contact) {
    return markRecipient(recipient.id, { status: "failed", error: "El contacto fue eliminado antes del envío" });
  }
  if (contact.waConsent !== "opt_in") {
    return markRecipient(recipient.id, {
      status: "failed",
      error:
        contact.waConsent === "opt_out"
          ? "Se dio de baja (opt_out) antes del envío: no se le envió"
          : "Ya no tiene consentimiento (opt_in) al momento del envío: no se le envió",
    });
  }
  if (contact.archivedAt) {
    return markRecipient(recipient.id, { status: "failed", error: "El contacto se archivó antes del envío" });
  }

  let rateLimitTry = 0;
  let unavailableTry = 0;
  for (;;) {
    try {
      const conversation = await getOrCreateConversation(organizationId, contact.id);
      const { messageId } = await sendTemplate({
        organizationId,
        conversationId: conversation.id,
        templateId,
        variables: resolveVariables(variables, contact.name),
      });
      return markRecipient(recipient.id, { status: "sent", messageId });
    } catch (err) {
      const decision = classify(err);
      if (decision.kind === "stop") throw new StopCampaign(decision.message);
      if (decision.kind === "rate_limit" && rateLimitTry < RATE_LIMIT_BACKOFF_MS.length) {
        const ms = RATE_LIMIT_BACKOFF_MS[rateLimitTry++]! * backoffScale();
        console.warn(`[campaign] límite de Meta (${decision.message}); pausa de ${ms} ms`);
        await sleep(ms);
        continue;
      }
      if (decision.kind === "unavailable" && unavailableTry < UNAVAILABLE_BACKOFF_MS.length) {
        await sleep(UNAVAILABLE_BACKOFF_MS[unavailableTry++]! * backoffScale());
        continue;
      }
      if (decision.kind === "rate_limit") {
        throw new StopCampaign(
          "Meta mantuvo el límite de envío tras varios reintentos. Los pendientes siguen pendientes: vuelve a intentar más tarde."
        );
      }
      return markRecipient(recipient.id, { status: "failed", error: decision.message });
    }
  }
}

type Decision =
  | { kind: "stop"; message: string }
  | { kind: "rate_limit"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "recipient"; message: string };

/** Qué hacer con un error de envío. Exportado para las pruebas unitarias. */
export function classify(err: unknown): Decision {
  if (err instanceof TemplateError) {
    if (err.code === "not_connected" || err.code === "reconnect_required") {
      return { kind: "stop", message: `WhatsApp desconectado: ${err.message}` };
    }
    if (err.code === "not_found" && /plantilla/i.test(err.message)) {
      return { kind: "stop", message: "La plantilla ya no existe" };
    }
    if (err.code === "invalid" && /aprobadas/i.test(err.message)) {
      return { kind: "stop", message: "La plantilla dejó de estar aprobada por Meta" };
    }
    return { kind: "recipient", message: err.message };
  }
  if (err instanceof SendError) {
    const code = err.metaCode ?? null;
    if (err.code === "reconnect_required" || err.code === "not_connected") {
      return { kind: "stop", message: `WhatsApp desconectado: ${err.message}` };
    }
    if (code !== null && RATE_LIMIT_CODES.has(code)) return { kind: "rate_limit", message: `código ${code}` };
    if (code !== null && QUALITY_STOP_CODES.has(code)) {
      return {
        kind: "stop",
        message: `Meta frenó los envíos del número por calidad (código ${code}). Revisa la calidad del número en el Administrador de WhatsApp antes de continuar.`,
      };
    }
    if (code !== null && TEMPLATE_STOP_CODES.has(code)) {
      return { kind: "stop", message: `Meta rechazó la plantilla (código ${code}): ${err.message}` };
    }
    if (err.code === "meta_unavailable") return { kind: "unavailable", message: err.message };
    if (err.code === "sandbox_violation") {
      return { kind: "recipient", message: "Contacto de pruebas del Laboratorio: no se envía" };
    }
    return { kind: "recipient", message: humanMetaError(code, err.message) };
  }
  console.error("[campaign] error inesperado al enviar:", err);
  return { kind: "recipient", message: "Error interno al enviar a este contacto" };
}

function humanMetaError(code: number | null, raw: string): string {
  if (code === 131026) return "El número no tiene WhatsApp o no puede recibir mensajes (131026)";
  if (code === 131056) return "Demasiados mensajes seguidos a este número (131056)";
  if (code === 131047) return "Fuera de la ventana de 24 h (131047)";
  if (code === 131050) return "El contacto dejó de recibir mensajes de marketing de este negocio (131050)";
  return raw;
}
