import { and, count, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { can } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { DEMO_AGENT_NAME } from "@/lib/demo";
import { onboardingKeys, type OnboardingState, type OnboardingStepKey } from "@/lib/onboarding";
import { orgHasWhatsAppConnection } from "@/server/credentials";
import { getConnection } from "@/server/credentials/direct";
import { getOrgModules, orgHasConexionDirecta } from "@/server/modules";
import { hasDemo } from "@/server/seed/demo";

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
    hidden: typeof onboarding.hiddenAt === "string",
    demo,
    whatsappConnected,
    approvedTemplates: templateRows[0]?.n ?? 0,
    canManage: can(session, "settings.manage"),
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

