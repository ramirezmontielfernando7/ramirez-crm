/**
 * Catálogo de planes que ve el cliente (nombre, precio, qué incluye). Reglas
 * puras y valores de fábrica: lo que el administrador de plataforma cambia
 * (Plataforma → Organizaciones y Planes → «Planes y precios») se guarda en
 * `platform_plan_catalog` y se monta ENCIMA de estos valores; sin fila, valen
 * los de aquí. Precios en pesos mexicanos más IVA. Messenger, Facebook e
 * Instagram no se ofrecen en ningún plan hasta probarlos.
 *
 * Los topes reales de cada empresa (personas, almacenamiento, IA) viven en su
 * ficha de Plataforma; los números de personas y almacenamiento de aquí son lo
 * que el plan promete al cliente en la ventana «Mejora tu plan».
 */

export const CATALOG_SCOPES = ["esencial", "pro", "ultra"] as const;
export type CatalogScope = (typeof CATALOG_SCOPES)[number];

export type PlanCatalogEntry = {
  scope: CatalogScope;
  name: string;
  tagline: string;
  /** Precio mensual en MXN (+IVA). */
  priceMonthlyMxn: number;
  /** Precio anual en MXN; `null` = «2 meses gratis» (10 mensualidades). */
  priceYearlyMxn: number | null;
  /** Cuota única de implementación en MXN (0 = sin cuota). */
  implementationFeeMxn: number;
  peopleLimit: number;
  storageGb: number;
  features: string[];
  recommended: boolean;
};

export type PlanCatalog = Record<CatalogScope, PlanCatalogEntry>;

export const DEFAULT_PLAN_CATALOG: PlanCatalog = {
  esencial: {
    scope: "esencial",
    name: "Esencial",
    tagline: "Para ordenar tu operación",
    priceMonthlyMxn: 499,
    priceYearlyMxn: null,
    implementationFeeMxn: 0,
    peopleLimit: 3,
    storageGb: 5,
    features: ["Bandeja y chat de equipo", "CRM Comercial, Tareas y Notas", "Resultados", "Sin agentes de IA"],
    recommended: false,
  },
  pro: {
    scope: "pro",
    name: "Pro",
    tagline: "Para que la IA atienda por ti",
    priceMonthlyMxn: 899,
    priceYearlyMxn: null,
    implementationFeeMxn: 500,
    peopleLimit: 5,
    storageGb: 10,
    features: ["Todo Esencial", "Agentes de IA y Estudio de IA", "Agenda y Atribución de anuncios (Meta)", "IA incluida: cupo estándar"],
    recommended: true,
  },
  ultra: {
    scope: "ultra",
    name: "Ultra",
    tagline: "Para operar a escala",
    priceMonthlyMxn: 1799,
    priceYearlyMxn: null,
    implementationFeeMxn: 500,
    peopleLimit: 15,
    storageGb: 50,
    features: ["Todo Pro", "Campañas masivas", "Asistente interno", "IA incluida: 4 veces el cupo de Pro"],
    recommended: false,
  },
};

/** Lo que guarda el administrador: solo lo que cambió; `null`/ausente = el valor de fábrica. */
export type PlanCatalogOverride = Partial<Omit<PlanCatalogEntry, "scope">>;

export const MAX_FEATURES = 8;

/** Precio anual: el guardado o, sin él, 10 mensualidades («2 meses gratis»). */
export function yearlyPrice(e: Pick<PlanCatalogEntry, "priceMonthlyMxn" | "priceYearlyMxn">): number {
  return e.priceYearlyMxn ?? e.priceMonthlyMxn * 10;
}

/** Meses de regalo del plan anual (12 − lo que pagas / mensualidad). */
export function freeMonths(e: Pick<PlanCatalogEntry, "priceMonthlyMxn" | "priceYearlyMxn">): number {
  if (e.priceMonthlyMxn <= 0) return 0;
  return Math.max(0, Math.round(12 - yearlyPrice(e) / e.priceMonthlyMxn));
}

/** «$1,799» (pesos enteros, sin centavos). */
export function formatMxn(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** El catálogo de fábrica con lo guardado encima. */
export function mergeCatalog(overrides: Partial<Record<CatalogScope, PlanCatalogOverride>>): PlanCatalog {
  const out = {} as PlanCatalog;
  for (const scope of CATALOG_SCOPES) {
    const base = DEFAULT_PLAN_CATALOG[scope];
    const o = overrides[scope] ?? {};
    out[scope] = {
      scope,
      name: o.name ?? base.name,
      tagline: o.tagline ?? base.tagline,
      priceMonthlyMxn: o.priceMonthlyMxn ?? base.priceMonthlyMxn,
      priceYearlyMxn: o.priceYearlyMxn === undefined ? base.priceYearlyMxn : o.priceYearlyMxn,
      implementationFeeMxn: o.implementationFeeMxn ?? base.implementationFeeMxn,
      peopleLimit: o.peopleLimit ?? base.peopleLimit,
      storageGb: o.storageGb ?? base.storageGb,
      features: o.features ?? base.features,
      recommended: o.recommended ?? base.recommended,
    };
  }
  // A lo sumo uno recomendado: si el administrador marcó varios, queda el primero.
  let seen = false;
  for (const scope of CATALOG_SCOPES) {
    if (out[scope].recommended && seen) out[scope] = { ...out[scope], recommended: false };
    if (out[scope].recommended) seen = true;
  }
  return out;
}

/** Limpia las viñetas escritas a mano: sin vacías, sin repetidas, recortadas. */
export function cleanFeatures(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const t = raw.trim().slice(0, 90);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= MAX_FEATURES) break;
  }
  return out;
}
