import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { orgHasModule } from "@/server/modules";
import { agentLabel, stageAgentForContact } from "./assignments";
import { type AgentConfig } from "./config";
import { ensureGeneralAgent } from "./ensure";
import { kbForAgent, toKbItems, type KbItem } from "./kb";

const log = logger("agentes");

/**
 * 031 — Una configuración de agente fijada por quien llama (el Laboratorio y
 * sus evaluaciones): se usa tal cual, con su conocimiento ya armado.
 */
export type AgentOverride = {
  agentId: string | null;
  config: AgentConfig;
  kb: KbItem[];
};

export type ResolvedAgent = {
  agentId: string;
  isGeneral: boolean;
  config: AgentConfig;
  /** Ya armado solo con override; si no, `kbForConfig` cuando haga falta. */
  kb: KbItem[] | null;
  /** El interruptor global de `agent_profile` (las conversaciones de prueba lo ignoran). */
  enabled: boolean;
};

/**
 * 031 — Qué agente atiende un turno. UNA sola función para todo el CRM:
 *
 * 1. Un override explícito (Laboratorio/evaluaciones) → ese.
 * 2. Si no → el agente GENERAL publicado. PR B: en conversaciones REALES el
 *    turno pasa después ese resultado por `withStageAgent` (el agente de la
 *    etapa del lead, solo con el módulo Laboratorio). Va en dos pasos para
 *    que los turnos que callan o traspasan antes del modelo no consulten la
 *    etapa.
 * 3. Sin general (no hay `agent_profile`) → nadie, ni el de la etapa: el
 *    agente calla como hoy calla sin perfil (`agent_profile` es también el
 *    interruptor global).
 *
 * Con el override, `enabled` sale del perfil igual (el pipeline lo ignora en
 * conversaciones de prueba, que son las únicas que usan override).
 */
export async function resolveAgentForTurn(
  organizationId: string,
  opts: { override?: AgentOverride } = {}
): Promise<ResolvedAgent | null> {
  const general = await ensureGeneralAgent(organizationId);
  if (!general) return null;
  if (opts.override) {
    return {
      agentId: opts.override.agentId ?? general.agent.id,
      isGeneral: opts.override.agentId === null || opts.override.agentId === general.agent.id,
      config: opts.override.config,
      kb: opts.override.kb,
      enabled: general.enabled,
    };
  }
  if (!general.published) {
    log.warn("el agente general no tiene configuración publicada legible: no responde", {
      org: organizationId,
      agente: general.agent.id,
    });
    return null;
  }
  return {
    agentId: general.agent.id,
    isGeneral: true,
    config: general.published,
    kb: null,
    enabled: general.enabled,
  };
}

/**
 * PR B — El agente de la etapa del lead de `contactId`, si el módulo
 * Laboratorio está encendido (D7) y la etapa tiene un agente publicado y no
 * archivado; si no, `general` tal cual. Una asignación que no opera se ignora
 * (`log.warn`) y atiende el general. Solo para conversaciones REALES sin
 * override (quien llama lo decide).
 */
export async function withStageAgent(
  organizationId: string,
  contactId: string,
  general: ResolvedAgent
): Promise<ResolvedAgent> {
  if (!(await orgHasModule(organizationId, "lab"))) return general;
  const staged = await stageAgentForContact(organizationId, contactId);
  if (staged.ok) {
    return { agentId: staged.agent.id, isGeneral: false, config: staged.config, kb: null, enabled: general.enabled };
  }
  if (staged.reason !== "no_assignment") {
    log.warn("la etapa tiene un agente que no puede atender: atiende el general", {
      org: organizationId,
      agente: staged.agentId,
      motivo: staged.reason,
    });
  }
  return general;
}

export type ConversationAgentPeek = {
  agentId: string;
  label: string;
  stageName: string;
};

/**
 * PR B — Para la Bandeja («Atiende: …»): qué agente por etapa atendería hoy
 * esta conversación. SOLO LEE (no garantiza ni reconcilia el general). `null`
 * = el general (o nadie: conversación de prueba, Laboratorio apagado).
 */
export async function peekAgentForConversation(
  organizationId: string,
  conversationId: string
): Promise<ConversationAgentPeek | null> {
  if (!(await orgHasModule(organizationId, "lab"))) return null;
  const [conversation] = await getDb()
    .select({ contactId: schema.conversation.contactId, isTest: schema.conversation.isTest })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  if (!conversation || conversation.isTest) return null;
  const staged = await stageAgentForContact(organizationId, conversation.contactId);
  if (!staged.ok) return null;
  return { agentId: staged.agent.id, label: agentLabel(staged.agent), stageName: staged.stageName };
}

/**
 * El conocimiento que leería un agente con una config dada (vista previa y
 * snapshot de una evaluación). El general siempre lee el compartido.
 */
export async function kbForConfig(
  organizationId: string,
  agent: { id: string; isGeneral: boolean },
  config: AgentConfig
): Promise<KbItem[]> {
  return toKbItems(await kbForAgent(organizationId, agent.id, agent.isGeneral || config.useSharedKb));
}
