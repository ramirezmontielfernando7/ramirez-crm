import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { seedOrgModules } from "@/server/modules/store";
import { insertGeneralFromProfile } from "@/server/agents/ensure";
import type { ModuleProfile } from "@/lib/modules/registry";

/** Etapas sembradas del pipeline (US2). */
export const SEED_STAGES: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Perdido", kind: "lost" },
];

/**
 * Lo que trae toda organización nueva: las etapas del pipeline, el perfil
 * del agente (apagado) y sus módulos (los de las variables de entorno). La usan el primer registro de la instancia
 * (`onUserCreated`) y el alta desde /platform: una sola definición.
 */
export async function seedOrganization(
  tx: Db,
  organizationId: string,
  /** 030 (PR 4) — Plantilla de módulos del alta desde /platform (opcional). */
  profile?: ModuleProfile
): Promise<void> {
  await tx.insert(schema.pipelineStage).values(
    SEED_STAGES.map((s, i) => ({
      id: newId("stage"),
      organizationId,
      name: s.name,
      position: i,
      kind: s.kind,
    }))
  );
  // 031: el perfil (interruptor global + espejo) y su agente general
  // publicado, con la misma hora: nacen al día.
  const at = new Date();
  const [profileRow] = await tx
    .insert(schema.agentProfile)
    .values({ id: newId("agentProfile"), organizationId, updatedAt: at })
    .returning();
  await insertGeneralFromProfile(tx, profileRow!);
  await seedOrgModules(tx, organizationId, profile);
}
