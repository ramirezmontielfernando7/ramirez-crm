import { describe, expect, it } from "vitest";
import { isOrganizationDetail, PLATFORM_TABS } from "@/components/platform/platform-tabs";
import { countByStatus, filterOrgs, orgPlanKey } from "@/lib/platform-orgs";

/** 040 — Plataforma → Organizaciones y Planes: filtros rápidos y pestañas. */
const org = (name: string, status: "active" | "suspended" | "deleted", planKey: "esencial" | "pro" | "ultra" | "custom" | null, owner = "dueno@x.test") => ({
  name,
  status,
  owners: [{ name: "Dueño", email: owner }],
  usage: planKey ? { plan: { planKey } } : null,
});

const ORGS = [
  org("Papelería Ñandú", "active", "esencial"),
  org("Clínica Sol", "suspended", "pro", "marta@sol.test"),
  org("Escuela Luna", "active", "ultra"),
  org("Taller Viejo", "deleted", null),
];

describe("filtros de organizaciones", () => {
  it("por estado", () => {
    expect(filterOrgs(ORGS, { status: "active" }).map((o) => o.name)).toEqual(["Papelería Ñandú", "Escuela Luna"]);
    expect(filterOrgs(ORGS, { status: "suspended" }).map((o) => o.name)).toEqual(["Clínica Sol"]);
    expect(filterOrgs(ORGS, { status: "all" })).toHaveLength(4);
  });

  it("por plan (sin fila de consumo cuenta como Personalizado)", () => {
    expect(filterOrgs(ORGS, { plan: "pro" }).map((o) => o.name)).toEqual(["Clínica Sol"]);
    expect(filterOrgs(ORGS, { plan: "custom" }).map((o) => o.name)).toEqual(["Taller Viejo"]);
    expect(orgPlanKey(ORGS[3]!)).toBe("custom");
  });

  it("búsqueda sin acentos por nombre o Propietario, combinada con los filtros", () => {
    expect(filterOrgs(ORGS, { q: "nandu" }).map((o) => o.name)).toEqual(["Papelería Ñandú"]);
    expect(filterOrgs(ORGS, { q: "MARTA" }).map((o) => o.name)).toEqual(["Clínica Sol"]);
    expect(filterOrgs(ORGS, { q: "marta", status: "active" })).toEqual([]);
  });

  it("contadores por estado", () => {
    expect(countByStatus(ORGS)).toEqual({ all: 4, active: 2, suspended: 1, deleted: 1 });
  });
});

describe("pestañas de Plataforma", () => {
  it("cinco secciones: organizaciones y planes, costos, webhooks sin ruta, conexión directa y administradores", () => {
    expect(PLATFORM_TABS.map((t) => t.href)).toEqual([
      "/platform/organizaciones",
      "/platform/costos",
      "/platform/webhooks",
      "/platform/conexion-directa",
      "/platform/admin",
    ]);
  });

  it("la ficha de una organización tiene su propio encabezado (volver + sus pestañas)", () => {
    expect(isOrganizationDetail("/platform/organizaciones")).toBe(false);
    expect(isOrganizationDetail("/platform/organizaciones/org_1")).toBe(true);
    expect(isOrganizationDetail("/platform/organizaciones/org_1/topes")).toBe(true);
    expect(isOrganizationDetail("/platform/costos")).toBe(false);
  });
});
