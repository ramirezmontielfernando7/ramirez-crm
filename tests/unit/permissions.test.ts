import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  can,
  roleLabel,
  type Permission,
  type Role,
} from "@/lib/auth/permissions";

/**
 * 020 — La matriz de permisos, escrita a mano. Si alguien cambia lo que puede
 * un rol en `permissions.ts`, este test lo obliga a decirlo también aquí: un
 * permiso que se cuela sin querer es exactamente lo que no debe pasar en
 * silencio.
 */
const MATRIZ: Record<Permission, Record<Role, boolean>> = {
  "pipeline.edit": { owner: true, coordinador: true, asesor: false },
  "templates.manage": { owner: true, coordinador: true, asesor: false },
  "settings.manage": { owner: true, coordinador: false, asesor: false },
  "agent.manage": { owner: true, coordinador: false, asesor: false },
  "users.manage": { owner: true, coordinador: false, asesor: false },
  "users.read": { owner: true, coordinador: true, asesor: false },
  "contacts.export": { owner: true, coordinador: false, asesor: false },
  "assignment.manage": { owner: true, coordinador: true, asesor: false },
  "scope.all": { owner: true, coordinador: true, asesor: false },
  "results.all": { owner: true, coordinador: true, asesor: false },
};

describe("matriz de permisos (020)", () => {
  for (const [permission, porRol] of Object.entries(MATRIZ)) {
    for (const [role, esperado] of Object.entries(porRol)) {
      it(`${role} ${esperado ? "SÍ" : "NO"} puede ${permission}`, () => {
        expect(can({ role }, permission as Permission)).toBe(esperado);
      });
    }
  }

  it("falla cerrado: un rol desconocido (p. ej. el viejo `member`) no puede nada", () => {
    for (const permission of Object.keys(MATRIZ) as Permission[]) {
      expect(can({ role: "member" }, permission)).toBe(false);
      expect(can({ role: "" }, permission)).toBe(false);
      expect(can({ role: "OWNER" }, permission)).toBe(false);
    }
  });

  it("desde Ajustes → Equipo no se puede crear otro propietario", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["coordinador", "asesor"]);
  });

  it("etiquetas en español", () => {
    expect(roleLabel("owner")).toBe("Propietario");
    expect(roleLabel("coordinador")).toBe("Coordinador");
    expect(roleLabel("asesor")).toBe("Asesor");
    expect(roleLabel("member")).toBe("Sin rol");
  });
});
