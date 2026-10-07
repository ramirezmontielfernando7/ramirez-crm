import { logger } from "@/lib/log";
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
 * 2. Si no → el agente GENERAL publicado. (PR B: antes de esto, el agente
 *    asignado a la etapa del lead, solo con el módulo Laboratorio.)
 * 3. Sin general publicado (no hay `agent_profile`) → nadie: el agente calla
 *    como hoy calla sin perfil.
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
