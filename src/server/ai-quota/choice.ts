import { envChoice, type AiChoice, type AiUse, type AssistantMode } from "@/lib/ai/choice";
import { getEnv } from "@/lib/env";

/**
 * El modelo y el esfuerzo con que responde un uso de IA a nombre de una
 * organización. Hoy: los de la instancia (variables de entorno, ver
 * `src/lib/ai/choice.ts`). Lo eligen por plan o por empresa desde Plataforma
 * lo sobrescribirá aquí, en la única puerta (`chatJsonForOrg`).
 */
export async function resolveAiChoice(_organizationId: string, use: AiUse, mode?: AssistantMode): Promise<AiChoice> {
  return envChoice(use, getEnv(), mode);
}
