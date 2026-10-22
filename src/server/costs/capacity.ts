import type { CapacityLine } from "@/lib/costs";
import { runWithOrganization } from "@/lib/request-context";
import { getEffectiveLimits } from "@/server/limits";
import { listOrganizations } from "@/server/platform-admin/organizations";

/**
 * Los topes de IA de cada organización (para la calculadora «¿cuánto me
 * costaría cada cliente?»). SOLO LECTURA y solo números: turnos, tokens,
 * tokens del asistente y de embeddings, con el valor efectivo (propio o del
 * entorno). Las borradas no entran.
 */
export async function getCapacityLines(): Promise<CapacityLine[]> {
  const orgs = (await listOrganizations()).filter((o) => o.status !== "deleted");
  const lines: CapacityLine[] = [];
  for (const o of orgs) {
    const l = await runWithOrganization(o.id, () => getEffectiveLimits(o.id));
    lines.push({
      organizationId: o.id,
      name: o.name,
      status: o.status,
      limits: {
        aiTurns: l.aiTurns.value,
        aiTokens: l.aiTokens.value,
        assistantTokens: l.assistantTokens.value,
        embedTokens: l.embedTokens.value,
      },
    });
  }
  return lines;
}
