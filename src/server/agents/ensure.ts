import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getDb, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { ALL_DOC_SOURCES } from "@/lib/kb-docs";
import { logger } from "@/lib/log";
import {
  configFromProfile,
  MIRROR_DEFAULT_NAME,
  mirrorFields,
  parseStoredConfig,
  sameConfig,
  type AgentConfig,
} from "./config";
import { appendPublishLog } from "./log";

const log = logger("agentes");

export type AgentRow = typeof schema.agent.$inferSelect;
type ProfileRow = typeof schema.agentProfile.$inferSelect;

export const GENERAL_INTERNAL_NAME = "Agente principal";

export type GeneralState = {
  /** El interruptor global (sigue viviendo en `agent_profile`). */
  enabled: boolean;
  agent: AgentRow;
  /** La config PUBLICADA del general (`null` si no se pudo leer). */
  published: AgentConfig | null;
};

/**
 * 031 — El agente GENERAL de una organización, garantizado.
 *
 * Toda organización con `agent_profile` tiene exactamente un general
 * publicado. La migración lo crea para las que existían; los seeds, fixtures
 * y scripts que solo insertan `agent_profile` quedan cubiertos aquí, de forma
 * perezosa e idempotente (el índice único parcial decide quién gana si dos
 * llegan a la vez). Sin `agent_profile` no se inventa nada: `null`, y el
 * agente calla como hoy.
 *
 * Reconciliación: corre en CADA turno y es una sola lectura (perfil + general
 * con un join). Solo escribe si detecta desfase: `agent_profile` cambió
 * después de la última publicación del general y su comportamiento ya no es
 * el que el espejo habría escrito. Pasa cuando la imagen anterior guarda el
 * perfil durante el despliegue o tras un rollback, o cuando el seed de la
 * demo lo actualiza. Entonces el perfil manda: se copia al general como
 * `legacy_put`.
 */
export async function ensureGeneralAgent(organizationId: string): Promise<GeneralState | null> {
  let read = await readGeneral(organizationId);
  if (!read) return null;
  if (!read.agent) {
    await insertGeneralFromProfile(getDb(), read.profile);
    read = await readGeneral(organizationId);
  }
  if (!read?.agent) return null;
  const profile = read.profile;
  let agent: AgentRow = read.agent;

  let published = parseStoredConfig(agent.published);
  if (needsReconcile(profile, agent, published)) {
    const fixed = await reconcile(organizationId);
    if (fixed) {
      agent = fixed;
      published = parseStoredConfig(fixed.published);
    }
  }
  return { enabled: profile.enabled, agent, published };
}

async function readGeneral(organizationId: string): Promise<{ profile: ProfileRow; agent: AgentRow | null } | null> {
  const [row] = await getDb()
    .select({ profile: schema.agentProfile, agent: schema.agent })
    .from(schema.agentProfile)
    .leftJoin(
      schema.agent,
      and(
        eq(schema.agent.organizationId, schema.agentProfile.organizationId),
        eq(schema.agent.isGeneral, true),
        isNull(schema.agent.archivedAt)
      )
    )
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

/** ¿El perfil cambió por fuera del espejo? (pura; la parte barata). */
export function needsReconcile(
  profile: Pick<ProfileRow, "name" | "tone" | "instructions" | "escalationRules" | "greeting" | "updatedAt">,
  agent: Pick<AgentRow, "publishedAt">,
  published: AgentConfig | null
): boolean {
  if (!published) return true;
  if (agent.publishedAt && profile.updatedAt.getTime() <= agent.publishedAt.getTime()) return false;
  const espejo = mirrorFields(published);
  return (
    espejo.name !== profile.name ||
    espejo.tone !== profile.tone ||
    espejo.instructions !== profile.instructions ||
    espejo.escalationRules !== profile.escalationRules ||
    espejo.greeting !== profile.greeting
  );
}

async function reconcile(organizationId: string): Promise<AgentRow | null> {
  return withTenant(organizationId, async (tx) => {
    const [profile] = await tx
      .select()
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId))
      .limit(1);
    const [agent] = await tx
      .select()
      .from(schema.agent)
      .where(
        scoped(schema.agent.organizationId, organizationId, and(eq(schema.agent.isGeneral, true), isNull(schema.agent.archivedAt)))
      )
      .limit(1)
      .for("update");
    if (!profile || !agent) return agent ?? null;
    const published = parseStoredConfig(agent.published);
    // Otro turno ya lo arregló mientras esperábamos el candado.
    if (!needsReconcile(profile, agent, published)) return agent;

    const fromProfile = configFromProfile(profile);
    const next: AgentConfig = {
      ...fromProfile,
      // «Asistente» en el perfil es lo que el espejo escribe para un general
      // SIN nombre: no se lo inventamos de vuelta.
      displayName:
        profile.name === MIRROR_DEFAULT_NAME && published && published.displayName === null ? null : profile.name,
      useSharedKb: published?.useSharedKb ?? true,
      // 037 — La selección de documentos no vive en `agent_profile`: se conserva.
      docSources: published?.docSources ?? ALL_DOC_SOURCES,
    };
    const draft = parseStoredConfig(agent.draft);
    const draftWasPublished = !draft || !published || sameConfig(draft, published);
    const [updated] = await tx
      .update(schema.agent)
      .set({
        published: next,
        publishedAt: profile.updatedAt,
        ...(draftWasPublished ? { draft: next } : {}),
        updatedAt: new Date(),
      })
      .where(scoped(schema.agent.organizationId, organizationId, eq(schema.agent.id, agent.id)))
      .returning();
    await appendPublishLog(tx, {
      organizationId,
      agentId: agent.id,
      action: "legacy_put",
      snapshot: next,
      actorUserId: null,
    });
    log.warn("agent_profile cambió por fuera del espejo: el agente general se puso al día", {
      org: organizationId,
      agente: agent.id,
    });
    return updated ?? agent;
  });
}

/**
 * Crea el general a partir del perfil, con `published_at = updated_at` del
 * perfil (al día). `db` es el de quien llama: el seed de una organización
 * nueva lo hace dentro de SU transacción (pool de sistema), los demás con la
 * BD de la organización.
 */
export async function insertGeneralFromProfile(
  db: Db,
  profile: Pick<ProfileRow, "organizationId" | "name" | "tone" | "instructions" | "escalationRules" | "greeting" | "updatedAt">
): Promise<void> {
  const config = configFromProfile(profile);
  await db
    .insert(schema.agent)
    .values({
      id: newId("agent"),
      organizationId: profile.organizationId,
      internalName: GENERAL_INTERNAL_NAME,
      isGeneral: true,
      draft: config,
      published: config,
      publishedAt: profile.updatedAt,
    })
    .onConflictDoNothing();
}
