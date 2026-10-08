import { GENERAL_GROUP_KEY } from "@/lib/kb-docs";
import { renderKb } from "@/server/ai/prompts";
import { listGroups } from "@/server/kb-docs/store";
import { parseStoredConfig, type AgentConfig } from "./config";
import { ensureGeneralAgent } from "./ensure";
import type { KbItem } from "./kb";
import { kbForConfig } from "./resolve";
import { AgentError, getAgent } from "./store";

export type RunSource = "draft" | "published";

/**
 * 031 — Lo que evalúa una corrida del Laboratorio, congelado al empezar
 * (`agent_test_run.agent_snapshot`): la config y el conocimiento tal como
 * estaban. El runner y el juez usan esto; si el agente cambia a media
 * corrida o después, el historial sigue diciendo qué se evaluó.
 */
export type RunSnapshot = {
  source: RunSource;
  agentId: string;
  internalName: string;
  isGeneral: boolean;
  config: AgentConfig;
  kb: KbItem[];
  kbText: string;
  /**
   * 037 — De qué documentos leyó, en palabras y tal como estaba al empezar
   * (`null` = todos los de la empresa). Lo que usa el turno es
   * `config.docSources`; esto es para el historial.
   */
  docSourceNames?: string[] | null;
};

export async function buildRunSnapshot(
  organizationId: string,
  opts: { agentId?: string; source?: RunSource }
): Promise<RunSnapshot> {
  const source = opts.source ?? "published";
  let agent: { id: string; internalName: string; isGeneral: boolean; draft: AgentConfig | null; published: AgentConfig | null };
  if (opts.agentId) {
    const found = await getAgent(organizationId, opts.agentId);
    if (!found) throw new AgentError("not_found", "Agente no encontrado");
    agent = found;
  } else {
    const general = await ensureGeneralAgent(organizationId);
    if (!general) throw new AgentError("not_found", "Esta organización no tiene agente");
    agent = {
      id: general.agent.id,
      internalName: general.agent.internalName,
      isGeneral: true,
      draft: parseStoredConfig(general.agent.draft),
      published: general.published,
    };
  }
  const config = source === "draft" ? agent.draft : agent.published;
  if (!config) {
    throw new AgentError("not_published", "Este agente no tiene versión publicada; evalúa su borrador");
  }
  const kb = await kbForConfig(organizationId, agent, config);
  let docSourceNames: string[] | null = null;
  if (config.docSources.mode === "groups") {
    const names = new Map((await listGroups(organizationId)).map((g) => [g.id ?? GENERAL_GROUP_KEY, g.name]));
    docSourceNames = config.docSources.groupIds.flatMap((id) => names.get(id) ?? []);
  }
  return {
    source,
    agentId: agent.id,
    internalName: agent.internalName,
    isGeneral: agent.isGeneral,
    config,
    kb,
    kbText: renderKb(kb),
    docSourceNames,
  };
}
