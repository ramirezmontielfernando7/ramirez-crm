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
  "contacts.export": { owner: true, coordinador: true, asesor: false },
  "contacts.import": { owner: true, coordinador: true, asesor: false },
  "tags.manage": { owner: true, coordinador: true, asesor: false },
  "campaigns.manage": { owner: true, coordinador: true, asesor: false },
  "assignment.manage": { owner: true, coordinador: true, asesor: false },
  "scope.all": { owner: true, coordinador: true, asesor: false },
  // 022: el Asesor no entra a Resultados, ni a los suyos.
  "results.read": { owner: true, coordinador: true, asesor: false },
  "results.all": { owner: true, coordinador: true, asesor: false },
  // 024: Conocimientos — mantenerlo es de quien opera; verlo y enviarlo, de todos.
  "knowledge.manage": { owner: true, coordinador: true, asesor: false },
  // 025: chat de equipo. Crear grupos: el Coordinador solo por delegación
  // (ver abajo). Supervisar: solo el Propietario, sin delegación posible.
  "team_chat.create_groups": { owner: true, coordinador: false, asesor: false },
  "team_chat.announce": { owner: true, coordinador: true, asesor: false },
  "team_chat.oversee": { owner: true, coordinador: false, asesor: false },
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

  it("025 — delegación: el Coordinador crea grupos SOLO si la organización lo encendió", () => {
    expect(can({ role: "coordinador" }, "team_chat.create_groups")).toBe(false);
    expect(
      can({ role: "coordinador", grants: ["team_chat.create_groups"] }, "team_chat.create_groups")
    ).toBe(true);
  });

  it("025 — un grant que la matriz no declara para ese rol no da nada", () => {
    // El Asesor no es destino de la delegación de grupos.
    expect(can({ role: "asesor", grants: ["team_chat.create_groups"] }, "team_chat.create_groups")).toBe(false);
    // La supervisión no es delegable, ni al Coordinador.
    expect(can({ role: "coordinador", grants: ["team_chat.oversee"] }, "team_chat.oversee")).toBe(false);
    // Un rol desconocido sigue sin poder nada, con o sin grants.
    expect(can({ role: "member", grants: ["team_chat.create_groups"] }, "team_chat.create_groups")).toBe(false);
  });

  it("etiquetas en español", () => {
    expect(roleLabel("owner")).toBe("Propietario");
    expect(roleLabel("coordinador")).toBe("Coordinador");
    expect(roleLabel("asesor")).toBe("Asesor");
    expect(roleLabel("member")).toBe("Sin rol");
  });
});
