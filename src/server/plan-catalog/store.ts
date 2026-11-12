import { eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import {
  CATALOG_SCOPES,
  cleanFeatures,
  mergeCatalog,
  normalizeContactPhone,
  type CatalogScope,
  type PlanCatalog,
  type PlanCatalogOverride,
} from "@/lib/plan-catalog";
import { recordPlatformAudit, type AuditActor } from "@/server/platform-admin/audit";
import { mergePlanProfiles, PLATFORM_MODULE_TOGGLES, type PlanProfiles, type PlatformModuleToggle } from "@/lib/platform-modules";
import type { ModuleProfile } from "@/lib/modules/registry";

/**
 * Catálogo de planes de la plataforma (`platform_plan_catalog`, tabla de
 * PLATAFORMA: solo el pool de sistema). ÚNICA puerta: lo lee la ventana
 * «Mejora tu plan» del Propietario y lo edita el administrador de plataforma.
 * Caché de 60 s que se limpia al guardar. Sin fila, valen los valores de
 * fábrica de `src/lib/plan-catalog.ts`.
 */

const TTL_MS = 60_000;
let cache: {
  at: number;
  catalog: PlanCatalog;
  overrides: Partial<Record<CatalogScope, PlanCatalogOverride>>;
  /** 0077: el WhatsApp de contacto de «¿Necesitas más?» (solo dígitos) o null. */
  contactWhatsapp: string | null;
  /** 048: qué módulos trae cada plan (fábrica + lo guardado). */
  profiles: PlanProfiles;
  /** 048: qué planes tienen módulos guardados a mano. */
  customModules: ModuleProfile[];
} | null = null;

export function clearPlanCatalogCache(): void {
  cache = null;
}

type Row = typeof schema.platformPlanCatalog.$inferSelect;

const overrideOf = (r: Row): PlanCatalogOverride => ({
  ...(r.name ? { name: r.name } : {}),
  ...(r.tagline ? { tagline: r.tagline } : {}),
  ...(r.priceMonthlyMxn !== null ? { priceMonthlyMxn: r.priceMonthlyMxn } : {}),
  ...(r.priceYearlyMxn !== null ? { priceYearlyMxn: r.priceYearlyMxn } : {}),
  ...(r.implementationFeeMxn !== null ? { implementationFeeMxn: r.implementationFeeMxn } : {}),
  ...(r.peopleLimit !== null ? { peopleLimit: r.peopleLimit } : {}),
  ...(r.storageGb !== null ? { storageGb: r.storageGb } : {}),
  ...(Array.isArray(r.features) && r.features.length > 0 ? { features: r.features } : {}),
  ...(r.recommended !== null ? { recommended: r.recommended } : {}),
});

async function load() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const db = getSystemDb();
  const rows = await db.select().from(schema.platformPlanCatalog);
  const settings = await db.select().from(schema.platformSetting);
  const overrides: Partial<Record<CatalogScope, PlanCatalogOverride>> = {};
  for (const r of rows) if ((CATALOG_SCOPES as readonly string[]).includes(r.scope)) overrides[r.scope as CatalogScope] = overrideOf(r);
  const contact = settings.find((r) => r.key === "contact_whatsapp")?.value ?? null;
  const moduleOverrides: Partial<Record<ModuleProfile, unknown>> = {};
  for (const r of rows) if ((CATALOG_SCOPES as readonly string[]).includes(r.scope) && r.modules) moduleOverrides[r.scope as ModuleProfile] = r.modules;
  cache = {
    at: Date.now(),
    catalog: mergeCatalog(overrides),
    overrides,
    contactWhatsapp: normalizeContactPhone(contact),
    profiles: mergePlanProfiles(moduleOverrides),
    customModules: Object.keys(moduleOverrides) as ModuleProfile[],
  };
  return cache;
}

/** Los tres planes tal como los ve el cliente (fábrica + lo guardado). */
export async function getPlanCatalog(): Promise<PlanCatalog> {
  return (await load()).catalog;
}

/**
 * 048 — Qué módulos trae cada plan HOY (fábrica + lo que guardó el
 * administrador). Lo usan el alta, las plantillas de /platform y el reflejo
 * del plan guardado (`syncPlanKey`).
 */
export async function getPlanProfiles(): Promise<PlanProfiles> {
  return (await load()).profiles;
}

/** 048 — Los planes con módulos guardados a mano (los demás, de fábrica). */
export async function getCustomModulePlans(): Promise<ModuleProfile[]> {
  return (await load()).customModules;
}

/**
 * 048 — Cambia qué módulos trae un plan (`null` = volver a los de fábrica).
 * No toca a ninguna empresa: vale para las altas y plantillas de aquí en
 * adelante. El Laboratorio solo con el Agente.
 */
export async function changePlanModules(
  scope: ModuleProfile,
  modules: Record<PlatformModuleToggle, boolean> | null,
  actor: AuditActor,
  ip: string | null
): Promise<PlanProfiles> {
  const db = getSystemDb();
  const clean = modules ? (Object.fromEntries(PLATFORM_MODULE_TOGGLES.map((k) => [k, modules[k] === true])) as Record<PlatformModuleToggle, boolean>) : null;
  if (clean && !clean.agent) clean.lab = false;
  const set = { modules: clean, updatedAt: new Date(), updatedBy: actor?.userId ?? null };
  await db.insert(schema.platformPlanCatalog).values({ scope, ...set }).onConflictDoUpdate({ target: schema.platformPlanCatalog.scope, set });
  clearPlanCatalogCache();
  await recordPlatformAudit({ actor, action: "plans.changed", detail: { plan: scope, modulos: clean ?? "de fábrica" }, ip });
  return getPlanProfiles();
}

/** 0077: el WhatsApp de contacto de la plataforma (solo dígitos) o null si no hay. */
export async function getPlatformContact(): Promise<string | null> {
  return (await load()).contactWhatsapp;
}

/** Guarda (o borra con `null`/vacío) el WhatsApp de contacto. Devuelve lo guardado. */
export async function changePlatformContact(input: string | null, actor: AuditActor, ip: string | null): Promise<string | null> {
  const value = input && input.trim() ? normalizeContactPhone(input) : null;
  if (input && input.trim() && !value) throw new Error("invalid_phone");
  const db = getSystemDb();
  const set = { value, updatedAt: new Date(), updatedBy: actor?.userId ?? null };
  await db
    .insert(schema.platformSetting)
    .values({ key: "contact_whatsapp", ...set })
    .onConflictDoUpdate({ target: schema.platformSetting.key, set });
  clearPlanCatalogCache();
  await recordPlatformAudit({ actor, action: "plans.changed", detail: { contactoWhatsapp: value ? `…${value.slice(-4)}` : null }, ip });
  return value;
}

/** Cambio parcial de un plan: un campo ausente no se toca; `null` vuelve al valor de fábrica. */
export type PlanCatalogPatch = {
  name?: string | null;
  tagline?: string | null;
  priceMonthlyMxn?: number | null;
  priceYearlyMxn?: number | null;
  implementationFeeMxn?: number | null;
  peopleLimit?: number | null;
  storageGb?: number | null;
  features?: string[] | null;
  recommended?: boolean | null;
};

export async function changePlanCatalog(scope: CatalogScope, patch: PlanCatalogPatch, actor: AuditActor, ip: string | null): Promise<PlanCatalog> {
  const db = getSystemDb();
  const [actual] = await db.select().from(schema.platformPlanCatalog).where(eq(schema.platformPlanCatalog.scope, scope)).limit(1);
  const pick = <K extends keyof PlanCatalogPatch>(k: K, cur: unknown) => (patch[k] === undefined ? cur : patch[k]);
  const features = patch.features === undefined ? (actual?.features ?? null) : patch.features === null ? null : cleanFeatures(patch.features);
  const values = {
    name: (pick("name", actual?.name ?? null) as string | null)?.trim() || null,
    tagline: (pick("tagline", actual?.tagline ?? null) as string | null)?.trim() || null,
    priceMonthlyMxn: pick("priceMonthlyMxn", actual?.priceMonthlyMxn ?? null) as number | null,
    priceYearlyMxn: pick("priceYearlyMxn", actual?.priceYearlyMxn ?? null) as number | null,
    implementationFeeMxn: pick("implementationFeeMxn", actual?.implementationFeeMxn ?? null) as number | null,
    peopleLimit: pick("peopleLimit", actual?.peopleLimit ?? null) as number | null,
    storageGb: pick("storageGb", actual?.storageGb ?? null) as number | null,
    features: features && features.length > 0 ? features : null,
    recommended: pick("recommended", actual?.recommended ?? null) as boolean | null,
    updatedAt: new Date(),
    updatedBy: actor?.userId ?? null,
  };
  await db
    .insert(schema.platformPlanCatalog)
    .values({ scope, ...values })
    .onConflictDoUpdate({ target: schema.platformPlanCatalog.scope, set: values });
  // Marcar un plan como recomendado quita la marca de los otros (uno solo).
  if (values.recommended === true) {
    for (const otro of CATALOG_SCOPES) {
      if (otro === scope) continue;
      await db.update(schema.platformPlanCatalog).set({ recommended: false, updatedAt: new Date(), updatedBy: actor?.userId ?? null }).where(eq(schema.platformPlanCatalog.scope, otro));
    }
  }
  clearPlanCatalogCache();
  await recordPlatformAudit({ actor, action: "plans.changed", detail: { plan: scope, cambios: patch }, ip });
  return getPlanCatalog();
}
