import { and, count, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { can } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { DEMO_AGENT_NAME, DEMO_PHONES } from "@/lib/demo";
import {
  onboardingExtraKeys,
  onboardingKeys,
  type OnboardingExtraKey,
  type OnboardingState,
  type OnboardingStepKey,
} from "@/lib/onboarding";
import { orgHasWhatsAppConnection } from "@/server/credentials";
import { getConnection } from "@/server/credentials/direct";
import { getOrgModules, orgHasConexionDirecta } from "@/server/modules";
import { hasDemo } from "@/server/seed/demo";
import { getConnectorSettings } from "@/server/ai-connector/settings";

/**
 * Auditoría UX 2026-11 (paquete A) — Qué le falta a la empresa para quedar
 * lista. Solo lectura, con el pool de la app (RLS); la única escritura es
 * «Ocultar guía» en `organization.metadata.onboarding` (sin migración, como
 * la apariencia).
 */

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Número de Meta guardado, o el dispositivo vinculado de la empresa conectado. */
export async function orgWhatsAppConnected(organizationId: string): Promise<boolean> {
  if (await orgHasWhatsAppConnection(organizationId)) return true;
  if (!(await orgHasConexionDirecta(organizationId))) return false;
  const conn = await getConnection(organizationId);
  return conn?.status === "connected";
}

export async function getOnboarding(session: SessionContext): Promise<OnboardingState> {
  const org = session.organizationId;
  const db = getDb();
  const [modules, whatsappConnected, demo, orgRows, profileRows, kbRows, publishRows, templateRows] = await Promise.all([
    getOrgModules(org),
    orgWhatsAppConnected(org),
    hasDemo(db, org),
    db.select({ metadata: schema.organization.metadata }).from(schema.organization).where(eq(schema.organization.id, org)).limit(1),
    db.select().from(schema.agentProfile).where(scoped(schema.agentProfile.organizationId, org)).limit(1),
    db.select({ n: count() }).from(schema.kbEntry).where(scoped(schema.kbEntry.organizationId, org)),
    db
      .select({ n: count() })
      .from(schema.agentPublishLog)
      .where(
        scoped(
          schema.agentPublishLog.organizationId,
          org,
          and(eq(schema.agentPublishLog.action, "publish"), isNotNull(schema.agentPublishLog.actorUserId))
        )
      ),
    db
      .select({ n: count() })
      .from(schema.template)
      .where(scoped(schema.template.organizationId, org, eq(schema.template.status, "approved"))),
  ]);
  const extras = await getExtras(org, modules.conectorIa);
  const profile = profileRows[0];
  const demoAgent = profile?.name === DEMO_AGENT_NAME;
  // Con la demo cargada, su conocimiento no cuenta como «ya le contaste de tu negocio».
  const agentConfigured =
    !demoAgent && ((!demo && (kbRows[0]?.n ?? 0) > 0) || !!profile?.instructions || !!profile?.tone || !!profile?.greeting);
  const done: Record<OnboardingStepKey, boolean> = {
    account: true,
    whatsapp: whatsappConnected,
    agent: agentConfigured,
    publish: (publishRows[0]?.n ?? 0) > 0,
    ai: !!profile?.enabled && !profile.pausedAt,
  };
  const meta = parseMetadata(orgRows[0]?.metadata ?? null);
  const onboarding = (meta.onboarding ?? {}) as { hiddenAt?: unknown };
  return {
    steps: onboardingKeys(modules.agent).map((key) => ({ key, done: done[key] })),
    extras: onboardingExtraKeys(modules.conectorIa).map((key) => ({
      key,
      done: extras[key],
      // Con el conector aún apagado, primero se enciende en sus ajustes.
      ...(key === "aiConnector" && !extras.connectorOn ? { href: "/settings/conector-ia" } : {}),
    })),
    conectorIa: modules.conectorIa,
    hidden: typeof onboarding.hiddenAt === "string",
    demo,
    whatsappConnected,
    approvedTemplates: templateRows[0]?.n ?? 0,
    canManage: can(session, "settings.manage"),
  };
}

/** Las etapas con las que nace toda empresa: si siguen igual, aún no las hizo suyas. */
const SEED_STAGE_NAMES = ["Nuevo", "En conversación", "Interesado", "Cliente", "Perdido"];

/**
 * Onboarding guiado (2026-11) — lo opcional, palomeado solo: alguien más en el
 * equipo, etapas o etiquetas propias, contactos reales (ni los de ejemplo ni
 * los simulados del Laboratorio, que nacen archivados) y una IA conectada.
 */
async function getExtras(
  org: string,
  conectorIa: boolean
): Promise<Record<OnboardingExtraKey | "connectorOn", boolean>> {
  const db = getDb();
  const [members, stages, tags, contacts, connections, connector] = await Promise.all([
    db.select({ n: count() }).from(schema.member).where(scoped(schema.member.organizationId, org)),
    db
      .select({ name: schema.pipelineStage.name })
      .from(schema.pipelineStage)
      .where(scoped(schema.pipelineStage.organizationId, org)),
    db.select({ n: count() }).from(schema.contactTag).where(scoped(schema.contactTag.organizationId, org)),
    db
      .select({ n: count() })
      .from(schema.contact)
      .where(
        scoped(
          schema.contact.organizationId,
          org,
          and(isNull(schema.contact.archivedAt), notInArray(schema.contact.waIdentity, [...DEMO_PHONES]))
        )
      ),
    conectorIa
      ? db
          .select({ n: count() })
          .from(schema.aiConnection)
          .where(scoped(schema.aiConnection.organizationId, org, isNull(schema.aiConnection.revokedAt)))
      : Promise.resolve([{ n: 0 }]),
    conectorIa ? getConnectorSettings(org) : Promise.resolve(null),
  ]);
  const names = stages.map((s) => s.name).sort();
  const stagesChanged = names.join("|") !== [...SEED_STAGE_NAMES].sort().join("|");
  return {
    team: (members[0]?.n ?? 0) > 1,
    pipeline: stagesChanged || (tags[0]?.n ?? 0) > 0,
    contacts: (contacts[0]?.n ?? 0) > 0,
    aiConnector: (connections[0]?.n ?? 0) > 0,
    connectorOn: !!connector?.enabled,
  };
}

/** «Ocultar guía» / volver a mostrarla. Toda la empresa (la ve el Propietario). */
export async function setOnboardingHidden(organizationId: string, hidden: boolean): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  meta.onboarding = hidden ? { hiddenAt: new Date().toISOString() } : {};
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
}

