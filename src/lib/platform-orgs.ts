import type { PlanKey } from "@/lib/limits";

/**
 * 040 — Plataforma → Organizaciones y Planes: los filtros rápidos de la tabla
 * (puros, sin React). Estado (Todas, Activas, Suspendidas, Borradas), plan
 * guardado y búsqueda por nombre o Propietario (sin acentos ni mayúsculas).
 */
export const ORG_STATUS_FILTERS = ["all", "active", "suspended", "deleted"] as const;
export type OrgStatusFilter = (typeof ORG_STATUS_FILTERS)[number];
export const ORG_STATUS_FILTER_LABEL: Record<OrgStatusFilter, string> = {
  all: "Todas",
  active: "Activas",
  suspended: "Suspendidas",
  deleted: "Borradas",
};

export type OrgPlanFilter = "all" | PlanKey;

type Filterable = {
  name: string;
  status: "active" | "suspended" | "deleted";
  owners: { name: string; email: string }[];
  usage: { plan: { planKey: PlanKey } } | null;
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** El plan guardado de una organización (sin fila de consumo: «Personalizado»). */
export function orgPlanKey(o: Pick<Filterable, "usage">): PlanKey {
  return o.usage?.plan.planKey ?? "custom";
}

export function filterOrgs<T extends Filterable>(
  orgs: readonly T[],
  f: { status?: OrgStatusFilter; plan?: OrgPlanFilter; q?: string }
): T[] {
  const q = fold(f.q?.trim() ?? "");
  return orgs.filter(
    (o) =>
      (!f.status || f.status === "all" || o.status === f.status) &&
      (!f.plan || f.plan === "all" || orgPlanKey(o) === f.plan) &&
      (!q || fold(o.name).includes(q) || o.owners.some((w) => fold(w.email).includes(q) || fold(w.name).includes(q)))
  );
}

/** Cuántas hay de cada estado (para los contadores de los filtros). */
export function countByStatus(orgs: readonly Pick<Filterable, "status">[]): Record<OrgStatusFilter, number> {
  const out: Record<OrgStatusFilter, number> = { all: orgs.length, active: 0, suspended: 0, deleted: 0 };
  for (const o of orgs) out[o.status] += 1;
  return out;
}
