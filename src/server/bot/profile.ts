import type { schema } from "@/lib/db";
import { renderKb } from "@/server/ai/prompts";

type AgentProfile = typeof schema.agentProfile.$inferSelect;
type KbEntry = Pick<typeof schema.kbEntry.$inferSelect, "kind" | "question" | "answer" | "content">;

/**
 * Payload del perfil del agente para un cerebro externo.
 *
 * `enabled` NO viaja: ese flag gobierna la IA in-process de Vocero; el bot
 * externo se pausa por conversación (`aiEnabled` del contexto y los handoffs),
 * no por este endpoint. `resources` nace vacío para que el shape del consumidor
 * no cambie cuando existan recursos alternativos reales.
 */
export function serializeBotProfile(profile: AgentProfile, kb: KbEntry[]) {
  return {
    profile: {
      name: profile.name,
      tone: profile.tone ?? null,
      instructions: profile.instructions ?? null,
      escalationRules: profile.escalationRules ?? null,
      greeting: profile.greeting ?? null,
    },
    kb: renderKb(kb),
    resources: [] as { label: string; url: string }[],
  };
}
