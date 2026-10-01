import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/** Etapas sembradas del pipeline (US2). */
export const SEED_STAGES: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Perdido", kind: "lost" },
];

/**
 * Lo que trae toda organización nueva: las etapas del pipeline y el perfil
 * del agente (apagado). La usan el primer registro de la instancia
 * (`onUserCreated`) y el alta desde /platform: una sola definición.
 */
export async function seedOrganization(tx: Db, organizationId: string): Promise<void> {
  await tx.insert(schema.pipelineStage).values(
    SEED_STAGES.map((s, i) => ({
      id: newId("stage"),
      organizationId,
      name: s.name,
      position: i,
      kind: s.kind,
    }))
  );
  await tx.insert(schema.agentProfile).values({
    id: newId("agentProfile"),
    organizationId,
  });
}
