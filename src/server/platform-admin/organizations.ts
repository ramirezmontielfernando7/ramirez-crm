import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { getSystemDb, schema, type Db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { platformOrgId } from "@/server/platform";
import { recordPlatformAudit, type AuditActor } from "./audit";
import { createAccountLink } from "./links";
import { forgetOrgStatus, type OrgStatus } from "./org-status";
import { seedOrganization } from "./seed";
import {
  getManyOrgModules,
  getOrgModules,
  OPTIONAL_CHANNELS,
  type OrgModules,
} from "@/server/modules";
import { envModuleDefaults } from "@/server/modules/defaults";
import { ModuleDependencyError, updateOrgModules, type ModulesPatch } from "@/server/modules/store";
import type { ModuleProfile } from "@/lib/modules/registry";
import type { EffectiveLimits, LimitsPatch } from "@/lib/limits";
import { PLATFORM_MODULE_TOGGLES, type PlatformModuleToggle } from "@/lib/platform-modules";
import { runWithOrganization } from "@/lib/request-context";
import { assertModulesWithinLimit, LimitError, saveOrgLimits } from "@/server/limits";
import { checkAllAlerts, checkModuleAlerts } from "@/server/limits/alerts";

/**
 * Fase 3, PR 2 — Gestión de organizaciones por el administrador de
 * plataforma: alta, estado y metadatos. NUNCA contenido de un negocio
 * (conversaciones, mensajes, contactos, notas): esa puerta (soporte con
 * consentimiento, exportación) se diseña aparte, después de lo legal.
 *
 * Pool de sistema: la plataforma está por encima de las organizaciones.
 */

export const PURGE_GRACE_DAYS = 30;

export class PlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys(): Db {
  return getSystemDb();
}

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string | null;
  status: OrgStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  purgeAfter: string | null;
  createdAt: string;
  isPlatform: boolean;
  members: number;
  owners: { userId: string; name: string; email: string }[];
  whatsappConnected: boolean;
  modules: ModulesDto;
};

/**
 * Fase 3, PR 3 — Los módulos opcionales de una organización tal como los ve
 * y edita /platform. Solo interruptores: ningún dato del negocio.
 */
export type ModulesDto = {
  campaigns: boolean;
  agenda: boolean;
  atribucion: boolean;
  instagram: boolean;
  messenger: boolean;
  campaignSendRate: number;
  /** 030 (PR 4) */
  knowledge: boolean;
  agent: boolean;
  lab: boolean;
  teamChat: boolean;
  results: boolean;
  customNav: boolean;
  /** 033 — Tareas y Notas. */
  trabajo: boolean;
};

export function modulesDto(m: OrgModules): ModulesDto {
  return {
    campaigns: m.campaigns,
    agenda: m.agenda,
    atribucion: m.atribucion,
    instagram: m.channels.has("instagram"),
    messenger: m.channels.has("messenger"),
    campaignSendRate: m.campaignSendRate,
    knowledge: m.knowledge,
    agent: m.agent,
    lab: m.lab,
    teamChat: m.teamChat,
    results: m.results,
    customNav: m.customNav,
    trabajo: m.trabajo,
  };
}

/** Todas las organizaciones, con solo metadatos. */
export async function listOrganizations(): Promise<OrganizationSummary[]> {
  const db = sys();
  const orgs = await db.select().from(schema.organization).orderBy(asc(schema.organization.createdAt));
  const ids = orgs.map((o) => o.id);
  if (ids.length === 0) return [];
  const counts = await db
    .select({ org: schema.member.organizationId, n: count() })
    .from(schema.member)
    .where(inArray(schema.member.organizationId, ids))
    .groupBy(schema.member.organizationId);
  const owners = await db
    .select({ org: schema.member.organizationId, userId: schema.user.id, name: schema.user.name, email: schema.user.email })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(and(inArray(schema.member.organizationId, ids), eq(schema.member.role, "owner")));
  const wa = await db
    .select({ org: schema.metaCredentials.organizationId })
    .from(schema.metaCredentials)
    .where(inArray(schema.metaCredentials.organizationId, ids));
  const platform = platformOrgId();
  // 036 (PR 4): una sola consulta para todas (antes, una por organización).
  const modulos = await getManyOrgModules(ids);
  const modules = new Map<string, ModulesDto>([...modulos].map(([id, m]) => [id, modulesDto(m)]));
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status,
    statusReason: o.statusReason,
    statusChangedAt: o.statusChangedAt?.toISOString() ?? null,
    purgeAfter: o.purgeAfter?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    isPlatform: o.id === platform,
    members: Number(counts.find((c) => c.org === o.id)?.n ?? 0),
    owners: owners.filter((w) => w.org === o.id).map(({ userId, name, email }) => ({ userId, name, email })),
    whatsappConnected: wa.some((w) => w.org === o.id),
    modules: modules.get(o.id) ?? modulesDto(envModuleDefaults()),
  }));
}

export type OrganizationMember = { userId: string; name: string; email: string; role: string };

/** Las personas de una organización (nombre, correo y rol; nada más). */
export async function listMembers(organizationId: string): Promise<OrganizationMember[]> {
  return sys()
    .select({ userId: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, organizationId))
    .orderBy(asc(schema.member.createdAt));
}

/** `Mi Negocio Ñandú` → `mi-negocio-nandu-k3x9` (único por el sufijo). */
export function slugFor(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "negocio";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

/**
 * Alta de una organización con su primer Propietario. En UNA transacción:
 * la organización, lo que toda organización trae (etapas, perfil del agente),
 * la cuenta de la persona (con una contraseña aleatoria que nadie conoce: no
 * puede entrar hasta activar) y su membresía. Después, el enlace de
 * activación (72 h), que se devuelve UNA vez.
 *
 * Un usuario pertenece a una sola organización: si el correo ya tiene cuenta,
 * 409 (sin decir de qué organización es).
 */
export async function createOrganization(
  input: { name: string; ownerName: string; ownerEmail: string; profile?: ModuleProfile },
  actor: AuditActor,
  ip: string | null
): Promise<{ organizationId: string; activationUrl: string; expiresAt: Date }> {
  const name = input.name.trim();
  const ownerName = input.ownerName.trim();
  const email = input.ownerEmail.trim().toLowerCase();
  const db = sys();

  const [taken] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${email}`)
    .limit(1);
  if (taken) {
    throw new PlatformError(409, "email_taken", "Ese correo ya tiene una cuenta en la plataforma. Cada persona pertenece a un solo negocio: usa otro correo.");
  }

  const organizationId = newId("organization");
  const userId = newId("user");
  // Nadie conoce esta contraseña: solo existe para que la cuenta no quede sin
  // credencial. La persona pone la suya con el enlace de activación.
  const unusable = await hashPassword(randomBytes(32).toString("base64url"));
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.organization).values({ id: organizationId, name, slug: slugFor(name) });
      await seedOrganization(tx as unknown as Db, organizationId, input.profile);
      await tx.insert(schema.user).values({ id: userId, name: ownerName, email, emailVerified: false });
      await tx.insert(schema.account).values({
        id: newId("account"),
        accountId: userId,
        providerId: "credential",
        userId,
        password: unusable,
      });
      await tx.insert(schema.member).values({ id: newId("member"), organizationId, userId, role: "owner" });
    });
  } catch (err) {
    // Carrera con otra alta del mismo correo: el índice único lo frena.
    if ((err as { code?: string; cause?: { code?: string } })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505") {
      throw new PlatformError(409, "email_taken", "Ese correo ya tiene una cuenta en la plataforma; usa otro.");
    }
    throw err;
  }

  const link = await createAccountLink(userId, "activate", actor?.userId ?? null);
  await recordPlatformAudit({
    actor,
    action: "organization.created",
    org: { id: organizationId, name },
    user: { id: userId, email },
    ...(input.profile ? { detail: { perfil_de_modulos: input.profile } } : {}),
    ip,
  });
  await recordPlatformAudit({ actor, action: "link.activation_created", org: { id: organizationId, name }, user: { id: userId, email }, detail: { caduca: link.expiresAt.toISOString() }, ip });
  return { organizationId, activationUrl: link.url, expiresAt: link.expiresAt };
}

export type StatusAction = "suspend" | "reactivate" | "delete" | "restore";

const TRANSITIONS: Record<StatusAction, { from: OrgStatus[]; to: OrgStatus; audit: "organization.suspended" | "organization.reactivated" | "organization.deleted" | "organization.restored" }> = {
  suspend: { from: ["active"], to: "suspended", audit: "organization.suspended" },
  reactivate: { from: ["suspended"], to: "active", audit: "organization.reactivated" },
  delete: { from: ["active", "suspended"], to: "deleted", audit: "organization.deleted" },
  restore: { from: ["deleted"], to: "active", audit: "organization.restored" },
};

/**
 * Suspender, reactivar, borrar (suave, 30 días de gracia) o restaurar. La
 * organización de la plataforma no se toca. Suspender o borrar cierra en el
 * acto las sesiones de sus personas.
 */
export async function changeOrganizationStatus(
  organizationId: string,
  action: StatusAction,
  reason: string | null,
  actor: AuditActor,
  ip: string | null,
  now = new Date()
): Promise<{ status: OrgStatus; purgeAfter: Date | null }> {
  if (organizationId === platformOrgId()) {
    throw new PlatformError(422, "platform_org", "La organización de la plataforma no se puede suspender ni borrar");
  }
  const t = TRANSITIONS[action];
  const db = sys();
  const [org] = await db.select().from(schema.organization).where(eq(schema.organization.id, organizationId)).limit(1);
  if (!org) throw new PlatformError(404, "not_found", "Organización no encontrada");
  if (!t.from.includes(org.status)) {
    throw new PlatformError(409, "invalid_transition", `No se puede ${verb(action)} una organización ${label(org.status)}`);
  }
  // Restaurar vale mientras no se haya purgado, aunque ya pasaran los 30 días.
  const purgeAfter = action === "delete" ? new Date(now.getTime() + PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000) : null;
  const [updated] = await db
    .update(schema.organization)
    .set({
      status: t.to,
      statusReason: reason?.trim() || null,
      statusChangedAt: now,
      deletedAt: action === "delete" ? now : action === "restore" ? null : org.deletedAt,
      purgeAfter: action === "delete" ? purgeAfter : action === "restore" ? null : org.purgeAfter,
    })
    // El WHERE repite el estado leído: dos administradores a la vez no se pisan.
    .where(and(eq(schema.organization.id, organizationId), eq(schema.organization.status, org.status)))
    .returning({ status: schema.organization.status });
  if (!updated) throw new PlatformError(409, "conflict", "La organización cambió mientras tanto; recarga");
  forgetOrgStatus(organizationId);

  if (t.to !== "active") {
    // Fuera en el acto: sus sesiones abiertas se cierran.
    const members = db.select({ id: schema.member.userId }).from(schema.member).where(eq(schema.member.organizationId, organizationId));
    await db.delete(schema.session).where(inArray(schema.session.userId, members));
  }
  await recordPlatformAudit({
    actor,
    action: t.audit,
    org: { id: org.id, name: org.name },
    detail: { de: org.status, a: t.to, motivo: reason?.trim() || null, ...(purgeAfter ? { borrable_desde: purgeAfter.toISOString() } : {}) },
    ip,
  });
  return { status: t.to, purgeAfter };
}

export type ModulesChange = Partial<Omit<ModulesDto, "campaignSendRate">> & {
  campaignSendRate?: number | null;
};

/**
 * Fase 3, PR 3 — Encender o apagar módulos de una organización. Vale también
 * para la de la plataforma (son sus módulos, no su estado). Cada cambio queda
 * en la bitácora con el antes y el después.
 */
export async function changeOrganizationModules(
  organizationId: string,
  change: ModulesChange,
  actor: AuditActor,
  ip: string | null
): Promise<ModulesDto> {
  const [org] = await sys()
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!org) throw new PlatformError(404, "not_found", "Organización no encontrada");
  const patch: ModulesPatch = {
    campaigns: change.campaigns,
    agenda: change.agenda,
    atribucion: change.atribucion,
    campaignSendRate: change.campaignSendRate,
    knowledge: change.knowledge,
    agent: change.agent,
    lab: change.lab,
    teamChat: change.teamChat,
    results: change.results,
    customNav: change.customNav,
    trabajo: change.trabajo,
  };
  if (change.instagram !== undefined || change.messenger !== undefined) {
    const current = modulesDto(await getOrgModules(organizationId));
    const want = {
      instagram: change.instagram ?? current.instagram,
      messenger: change.messenger ?? current.messenger,
    };
    patch.channels = OPTIONAL_CHANNELS.filter((c) => want[c]);
  }
  // 036 (PR 3a): el tope de módulos activos (encender de más se rechaza; apagar, nunca).
  const actuales = modulesDto(await getOrgModules(organizationId));
  const siguientes = { ...actuales } as Record<PlatformModuleToggle, boolean>;
  for (const k of PLATFORM_MODULE_TOGGLES) {
    const v = change[k];
    if (v !== undefined) siguientes[k] = v;
  }
  if (!siguientes.agent) siguientes.lab = false;
  try {
    await runWithOrganization(organizationId, () => assertModulesWithinLimit(organizationId, actuales, siguientes));
  } catch (err) {
    if (err instanceof LimitError) throw new PlatformError(err.status, err.code, err.message);
    throw err;
  }
  let result: Awaited<ReturnType<typeof updateOrgModules>>;
  try {
    result = await updateOrgModules(organizationId, patch, actor?.email ?? "plataforma");
  } catch (err) {
    if (err instanceof ModuleDependencyError) throw new PlatformError(422, "module_dependency", err.message);
    throw err;
  }
  const { before, after } = result;
  const de = modulesDto(before);
  const a = modulesDto(after);
  const cambios = (Object.keys(a) as (keyof ModulesDto)[]).filter((k) => de[k] !== a[k]);
  if (cambios.length > 0) {
    await recordPlatformAudit({
      actor,
      action: "organization.modules_changed",
      org: { id: org.id, name: org.name },
      detail: Object.fromEntries(cambios.map((k) => [k, { de: de[k], a: a[k] }])),
      ip,
    });
    await runWithOrganization(organizationId, () => checkModuleAlerts(organizationId));
  }
  return a;
}

/**
 * 036 (PR 3a) — Cambiar el plan y los topes de una organización (solo el
 * administrador de plataforma). Bajar un tope por debajo del uso no quita
 * nada: solo impide crecer. Queda en la bitácora con el antes y el después,
 * y se revisan los avisos al momento.
 */
export async function changeOrganizationLimits(
  organizationId: string,
  patch: LimitsPatch,
  actor: AuditActor,
  ip: string | null
): Promise<EffectiveLimits> {
  const [org] = await sys()
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!org) throw new PlatformError(404, "not_found", "Organización no encontrada");
  const { before, after } = await saveOrgLimits(organizationId, patch, actor?.userId ?? null);
  const cambios = (Object.keys(after) as (keyof EffectiveLimits)[]).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])
  );
  if (cambios.length > 0) {
    await recordPlatformAudit({
      actor,
      action: "organization.limits_changed",
      org: { id: org.id, name: org.name },
      detail: Object.fromEntries(cambios.map((k) => [k, { de: before[k], a: after[k] }])),
      ip,
    });
  }
  await runWithOrganization(organizationId, () => checkAllAlerts(organizationId));
  return after;
}

function verb(a: StatusAction): string {
  return { suspend: "suspender", reactivate: "reactivar", delete: "borrar", restore: "restaurar" }[a];
}
function label(s: OrgStatus): string {
  return { active: "activa", suspended: "suspendida", deleted: "borrada" }[s];
}

/** Un usuario (para restablecer su contraseña): de qué organización es. */
export async function findUserForReset(userId: string): Promise<{ id: string; email: string; name: string; org: { id: string; name: string } | null } | null> {
  const db = sys();
  const [person] = await db.select({ id: schema.user.id, email: schema.user.email, name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  if (!person) return null;
  const [m] = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(eq(schema.member.userId, userId))
    .orderBy(desc(schema.member.createdAt))
    .limit(1);
  return { ...person, org: m ?? null };
}
