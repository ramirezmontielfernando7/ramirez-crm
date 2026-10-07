import { isOrgActive } from "@/server/platform-admin/org-status";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { moveLeadToStage as moveLeadThroughHistory } from "@/server/leads/stage-history";
import { getEnv, isAiConfigured } from "@/lib/env";
import type { ChatMessage } from "@/lib/ai";
import { chatJsonForOrg } from "@/server/ai-quota/llm";
import { publish } from "@/server/events/bus";
import { logActivity, logActivitySafe } from "@/server/activity/log";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import {
  agentActionSchema,
  degradeAction,
  resolveStage,
  type AgentActionType,
} from "@/server/ai/actions";
import { HANDOFF_BACKUP_ACK, matchesHandoffIntent } from "@/server/ai/handoff";
import { announceHandoff } from "@/server/inbox/handoff-notice";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { toPromptConfig, type AgentPromptConfig } from "@/server/agents/config";
import type { KbItem } from "@/server/agents/kb";
import { kbForConfig, resolveAgentForTurn, type AgentOverride } from "@/server/agents/resolve";
import { agendaEnabled } from "@/server/agenda/flag";
import { bookSlot, offerSlots } from "@/server/agenda/agent";
import { getOffers, mapaDeHuecosParaModelo } from "@/server/agenda/offers";
import { logger } from "@/lib/log";
import { currentOrganizationId, runWithOrganization } from "@/lib/request-context";
import { orgHasModule } from "@/server/modules";

const log = logger("agente");

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Coalesce + lock in-process por conversación: ráfagas de mensajes → UNA
 * respuesta; nunca dos turnos simultáneos; lo que llega durante un turno
 * re-encola exactamente un turno más. Suficiente para el monolito de una
 * instancia (sin colas externas — Constitución II).
 */

type CoalesceEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};

const globalForAgent = globalThis as unknown as {
  __agentCoalesce?: Map<string, CoalesceEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForAgent.__agentCoalesce) {
    globalForAgent.__agentCoalesce = new Map();
  }
  return globalForAgent.__agentCoalesce;
}

/** Punto de entrada con debounce (mensajes entrantes reales). */
export function scheduleAgentTurn(conversationId: string): void {
  // PR 3: el turno hereda la organización de quien lo agenda (la ingesta ya
  // enrutada o la request). Sin ella no hay a nombre de quién consultar.
  const organizationId = currentOrganizationId();
  if (!organizationId) {
    log.error("turno agendado sin organización: descartado", { conversacion: conversationId });
    return;
  }
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    timer: null,
    running: false,
    pending: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true; // se re-encola al terminar el turno actual
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  const delay = getEnv().AGENT_COALESCE_MS;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void runWithOrganization(organizationId, () => executeTurn(conversationId));
  }, delay);
}

async function executeTurn(conversationId: string): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runAgentTurn(conversationId);
  } catch (err) {
    log.error("turno falló", { conversacion: conversationId, err });
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      void executeTurn(conversationId);
    } else {
      map.delete(conversationId);
    }
  }
}

/**
 * 031 — Opciones del turno. `agentOverride`: el Laboratorio (evaluaciones)
 * fija la config y el conocimiento a evaluar en vez de resolverlos.
 */
export type TurnOptions = { agentOverride?: AgentOverride };

type Conversation = typeof schema.conversation.$inferSelect;
type Stage = { id: string; name: string };

/** Lo que necesita `decideTurn`: todo en memoria, nada de la BD. */
export type DecideInput = {
  organizationId: string;
  /** "agent" en conversaciones reales; "lab" en el Laboratorio y la vista previa. */
  kind: "agent" | "lab";
  config: AgentPromptConfig;
  kb: KbItem[];
  stages: Stage[];
  agenda: boolean;
  history: { role: "user" | "assistant"; content: string }[];
  /** System al FINAL (el mapa de huecos de la agenda), si lo hay. */
  tail?: string | null;
};

export type DecisionMeta = {
  ms: number;
  model: string | null;
  tokens: { prompt: number; completion: number } | null;
  kbEntryIds: string[];
};

export type TurnDecision =
  | { ok: true; action: AgentActionType; stage: Stage | null; meta: DecisionMeta }
  | {
      ok: false;
      error: "not_configured" | "quota_exceeded" | "provider_error" | "invalid_output";
      detail: string;
      meta: DecisionMeta;
    };

type TurnPlan =
  | { kind: "silent" }
  | { kind: "window_closed"; conversation: Conversation }
  | { kind: "backup_handoff"; conversation: Conversation }
  | { kind: "decide"; conversation: Conversation; input: DecideInput };

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 *
 * 031: tres piezas — `loadTurnContext` (qué conversación, qué agente, qué
 * sabe), `decideTurn` (prompt + modelo + validación, SIN efectos en la BD;
 * la vista previa del Laboratorio la reutiliza) y `executeAction` (enviar,
 * mover, anotar, traspasar, agenda).
 */
export async function runAgentTurn(conversationId: string, opts: TurnOptions = {}): Promise<void> {
  const plan = await loadTurnContext(conversationId, opts);
  switch (plan.kind) {
    case "silent":
      return;
    case "window_closed":
      // Ventana cerrada: el agente JAMÁS envía texto libre → handoff 'ventana'.
      await applyHandoff(plan.conversation.id, plan.conversation.organizationId, "ventana");
      return;
    case "backup_handoff":
      // Patrón de respaldo ANTES del LLM (FR-022). Avisa y traspasa, en el
      // mismo orden que el camino del modelo (`farewell` y luego handoff):
      // callar ante quien pide una persona se lee como que el bot dejó de
      // contestar.
      await acknowledgeHandoff(plan.conversation);
      await applyHandoff(plan.conversation.id, plan.conversation.organizationId, "cliente");
      return;
    case "decide": {
      const decision = await decideTurn(plan.input);
      await executeAction(plan.conversation, plan.input, decision);
      return;
    }
  }
}

/** Todo lo que el turno necesita saber, en el orden de siempre. */
async function loadTurnContext(conversationId: string, opts: TurnOptions): Promise<TurnPlan> {
  if (!isAiConfigured()) return { kind: "silent" };

  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) return { kind: "silent" };
  const organizationId = conversation.organizationId;

  // Condiciones de silencio: handoff activo o IA apagada en la conversación.
  if (conversation.handoffAt || !conversation.aiEnabled) return { kind: "silent" };
  // Fase 3, PR 2: una organización suspendida no gasta IA ni contesta.
  if (!(await isOrgActive(organizationId))) return { kind: "silent" };
  // 030 (PR 4): con el módulo Agente apagado por la plataforma, el agente
  // incluido no existe para esta organización (el Laboratorio tampoco).
  if (!(await orgHasModule(organizationId, conversation.isTest ? "lab" : "agent"))) return { kind: "silent" };

  // 031: el agente que atiende (hoy, el general publicado; el Laboratorio
  // puede fijar otro). Sin `agent_profile` no hay agente, como siempre.
  const agent = await resolveAgentForTurn(organizationId, { override: opts.agentOverride });
  if (!agent) return { kind: "silent" };
  // El toggle global aplica a conversaciones reales; el Laboratorio evalúa el
  // comportamiento configurado aunque el agente aún no esté encendido.
  if (!conversation.isTest && !agent.enabled) return { kind: "silent" };

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");
  if (!lastInbound) return { kind: "silent" };

  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    return { kind: "window_closed", conversation };
  }
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    return { kind: "backup_handoff", conversation };
  }

  const kb = agent.kb ?? (await kbForConfig(organizationId, { id: agent.agentId, isGeneral: agent.isGeneral }, agent.config));
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const agenda = await agendaEnabled(organizationId);

  /**
   * 015 — Los huecos vigentes, con su instante exacto.
   *
   * `book_slot` exige el `startUtc` y `findOffered` compara por epoch, sin
   * tolerancia. Pero al modelo solo le llegaban el prompt y el historial de
   * TEXTO, donde están las etiquetas que leyó el cliente —«lun 7 sep, 11:00»—
   * sin año, sin zona y sin la fecha de hoy. Con eso, acertar el instante era
   * cuestión de suerte: el rechazo caía siempre en `slot_not_offered`, cuyo
   * texto es fijo, y la conversación se quedaba en bucle repitiendo la lista.
   *
   * Es un agujero de INTEGRACIÓN: las pruebas de contrato pasan porque
   * inyectan el ISO correcto, que es justo lo que el modelo no tenía.
   *
   * Sin oferta vigente no se añade nada, así que el modelo sigue obligado a
   * ofrecer antes de reservar. Se entrega el catálogo COMPLETO, no solo los
   * tres que se enseñaron: si el cliente pide otro día, ese hueco ya estaba
   * registrado como ofrecido y ahora el modelo también lo conoce.
   *
   * Reportado por @Diony7004 en #50, con el diagnóstico ya hecho.
   */
  const ofertas = agenda ? await getOffers(organizationId, conversationId) : [];
  const mapaDeHuecos = mapaDeHuecosParaModelo(ofertas);

  return {
    kind: "decide",
    conversation,
    input: {
      organizationId,
      // Fase 3: el Laboratorio cuenta aparte ("lab") pero contra el mismo tope.
      kind: conversation.isTest ? "lab" : "agent",
      config: toPromptConfig(agent.config),
      kb,
      stages,
      agenda,
      history: history
        .filter((m) => m.text)
        .map((m) => ({
          role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
          content: m.text!,
        })),
      tail: mapaDeHuecos,
    },
  };
}

/**
 * Arma el prompt, llama al modelo (a nombre de la organización y contra su
 * cuota) y valida la acción contra lo que este turno permite. SIN efectos en
 * la BD fuera de la cuota: la vista previa del Laboratorio la usa tal cual.
 */
export async function decideTurn(input: DecideInput): Promise<TurnDecision> {
  const started = Date.now();
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({
        config: input.config,
        kb: input.kb,
        stages: input.stages,
        agenda: input.agenda,
      }),
    },
    ...input.history,
    /**
     * Va AL FINAL, después del historial: es el estado de AHORA, y ponerlo
     * antes lo dejaría enterrado bajo la conversación en cuanto esta crezca.
     */
    ...(input.tail ? [{ role: "system" as const, content: input.tail }] : []),
  ];

  const result = await chatJsonForOrg(
    input.organizationId,
    input.kind,
    agentActionSchema(input.agenda),
    messages
  );
  const meta: DecisionMeta = {
    ms: Date.now() - started,
    // Solo para «Por qué respondió así»: leído sin validar el entorno entero.
    model: process.env.OPENROUTER_MODEL?.trim() || null,
    tokens: result.usage
      ? { prompt: result.usage.promptTokens, completion: result.usage.completionTokens }
      : null,
    kbEntryIds: input.kb.map((e) => e.id),
  };
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail, meta };

  let action: AgentActionType = result.data;
  // 015 — Sin agenda, sus acciones no existen en este turno: se degradan.
  if ((action.action === "offer_slots" || action.action === "book_slot") && !input.agenda) {
    action = degradeAction(action);
  }
  let stage: Stage | null = null;
  if (action.action === "move_stage") {
    stage = resolveStage(action.stage, input.stages);
    if (!stage) action = degradeAction(action);
  }
  return { ok: true, action, stage, meta };
}

/** Los efectos del turno: lo que antes hacía el final de `runAgentTurn`. */
async function executeAction(
  conversation: Conversation,
  input: DecideInput,
  decision: TurnDecision
): Promise<void> {
  const organizationId = conversation.organizationId;
  const conversationId = conversation.id;

  if (!decision.ok) {
    if (decision.error === "not_configured") return;
    if (decision.error === "quota_exceeded") {
      // Sin cuota el agente no puede contestar: pasa a una persona, con su
      // motivo en la línea de tiempo. En el Laboratorio solo se calla.
      if (!conversation.isTest) await applyHandoff(conversationId, organizationId, "cuota");
      return;
    }
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022).
    // H27: sin la salida cruda del modelo (puede traer texto de la
    // conversación): el código y cuánto medía bastan para diagnosticar.
    log.error("fallo del proveedor de IA; se escala a una persona", {
      org: organizationId,
      conversacion: conversationId,
      error: decision.error,
      detalleCaracteres: decision.detail?.length ?? 0,
    });
    await applyHandoff(conversationId, organizationId, "error");
    return;
  }

  let action = decision.action;

  // 015 — Agenda. Un fallo del motor degrada el turno (el agente responde sin
  // agendar), nunca lo tumba: quedarse callado es peor que no agendar.
  if ((action.action === "offer_slots" || action.action === "book_slot") && input.agenda) {
    try {
      const turn =
        action.action === "offer_slots"
          ? await offerSlots({
              organizationId,
              conversationId,
              intro: action.reply,
            })
          : await bookSlot({
              organizationId,
              conversationId,
              startUtc: action.startUtc,
              confirmation: action.reply,
            });
      await deliverReply(conversation, turn.text);
      if (turn.ok) {
        publish(organizationId, {
          type: "conversation.updated",
          data: { conversation: { id: conversationId } },
        });
      }
      return;
    } catch (err) {
      log.error("el motor de agenda falló", { org: organizationId, conversacion: conversationId, err });
      action = degradeAction(action);
    }
  }

  if (action.action === "move_stage" && decision.stage) {
    await moveLeadToStage(organizationId, conversation.contactId, decision.stage.id);
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: conversationId } },
    });
    if (action.reply) {
      await deliverReply(conversation, action.reply);
    }
    return;
  }

  switch (action.action) {
    case "none":
      return;
    case "reply":
      await deliverReply(conversation, action.text);
      return;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action.note);
      if (action.reply) await deliverReply(conversation, action.reply);
      return;
    }
    case "handoff": {
      if (action.farewell) {
        await deliverReply(conversation, action.farewell);
      }
      await applyHandoff(conversationId, organizationId, "modelo");
      return;
    }
  }
}


/** Entrega la respuesta: envío real o persistencia sandbox (is_test). */
async function deliverReply(
  conversation: Conversation,
  text: string
): Promise<void> {
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text);
    return;
  }
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
    });
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return;
    }
    throw err;
  }
}

/**
 * FR-022 — El acuse del patrón de respaldo, antes de traspasar.
 *
 * Sale por `deliverReply`, el mismo camino que el `farewell` del modelo, así
 * que hereda sus garantías: una conversación del Laboratorio lo persiste sin
 * tocar la API, y con la ventana de 24 h cerrada no sale texto libre (el turno
 * ya traspasó por `ventana` antes de llegar aquí, y el emisor lo rechazaría
 * igual). Tampoco se repite si el turno vuelve a correr: el traspaso deja
 * `handoffAt` puesto y el turno siguiente se calla en la primera comprobación,
 * igual que tras el `farewell`.
 *
 * Lo único que cambia respecto a ese camino: si el envío falla, el traspaso
 * se aplica IGUAL. Quien pidió una persona tiene que llegar a una aunque el
 * aviso no haya salido; dejarlo con la IA encendida sería peor que el silencio.
 */
async function acknowledgeHandoff(conversation: Conversation): Promise<void> {
  try {
    await deliverReply(conversation, HANDOFF_BACKUP_ACK);
  } catch (err) {
    log.error("el acuse del traspaso no salió; se traspasa igual", {
      org: conversation.organizationId,
      conversacion: conversation.id,
      err,
    });
  }
}

/** Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031). */
async function persistTestOutbound(
  conversation: Conversation,
  text: string
): Promise<void> {
  const db = getDb();
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: "text",
    text,
    status: "sent",
    aiGenerated: true,
    origin: "ai",
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana" | "cuota"
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversationId))
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
  // 026: el aviso, aparte del estado (asignado + quien ve todo; no participantes).
  await announceHandoff(organizationId, conversationId, reason);
  // 022: queda en la línea de tiempo del chat.
  await logActivitySafe({
    organizationId,
    contactId: updated[0].contactId,
    kind: "ai_handoff",
    source: "bot",
    detail: { reason },
  });
}

async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  const leadId = rows[0]?.id;
  if (!leadId) return;

  // Por la puerta única: el agente mueve tarjetas igual que el dueño, y su
  // movimiento tiene que quedar en la bitácora o el embudo mentirá sobre
  // quién hizo avanzar cada lead.
  await moveLeadThroughHistory({
    organizationId,
    leadId,
    toStageId: stageId,
    source: "bot",
    extra: { lastActivityAt: new Date() },
    // El agente no clasifica pérdidas: si su etapa destino resultara ser la
    // perdida, la puerta lo rechaza y el lead se queda donde está — mejor eso
    // que un motivo inventado.
  });
}

async function appendLeadNote(
  organizationId: string,
  contactId: string,
  note: string
): Promise<void> {
  // 022: las notas viven en la línea de tiempo, con autor y hora. La del
  // agente queda "por el agente de IA"; ya no se pega a `contact.notes`, que
  // se conserva como la "Nota inicial".
  await logActivity({
    organizationId,
    contactId,
    kind: "note_added",
    source: "bot",
    detail: { text: note },
  });
}
