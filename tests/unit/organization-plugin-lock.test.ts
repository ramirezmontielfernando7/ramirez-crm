import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

/**
 * H3 — La API del plugin de organización de better-auth está cerrada.
 *
 * Antes cualquier usuario con sesión (un Asesor incluido) podía crear
 * organizaciones con `/api/auth/organization/create`, y el Propietario podía
 * borrar la suya en cascada, invitar o sacar miembros por esas rutas,
 * saltándose los permisos y la bitácora de la app. Vocero no usa ninguna: el
 * alta de la organización la hace `onUserCreated` en la BD y el equipo se
 * administra por `/api/settings/team`.
 *
 * Tres capas, las tres probadas aquí:
 * 1. El hook `before` responde 403 a TODA ruta `/organization/*`, antes de
 *    leer la sesión o tocar la BD (no depende del rol).
 * 2. El plugin tiene `allowUserToCreateOrganization: false` y
 *    `disableOrganizationDeletion: true`.
 * 3. Ningún rol (Propietario, Coordinador, Asesor) tiene los recursos propios
 *    del plugin (`organization`, `member`, `invitation`).
 *
 * La prueba con sesiones reales de los tres roles contra la app viva está en
 * `scripts/e2e-roles.mjs`.
 */

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    APP_BASE_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "secreto-de-prueba-de-al-menos-32-caracteres",
  }),
}));

// Una BD a la que no se puede llegar: postgres-js conecta perezosamente, así
// que si alguna ruta de /organization/* la tocara, respondería 500, no 403.
vi.mock("@/lib/db", () => ({
  schema,
  getSystemDb: () => drizzle(postgres("postgres://nadie:nada@127.0.0.1:1/ninguna", { max: 1 }), { schema }),
}));

const { getAuth, isOrganizationPluginPath } = await import("@/lib/auth");
const { ROLES, roles } = await import("@/lib/auth/permissions");

const BLOCKED = [
  "/organization/create",
  "/organization/delete",
  "/organization/remove-member",
  "/organization/invite-member",
  "/organization/update-member-role",
  "/organization/update",
  "/organization/leave",
  "/organization/set-active",
  "/organization/list-members",
];

describe("H3 · rutas del plugin de organización cerradas", () => {
  it("reconoce toda ruta del plugin y ninguna otra", () => {
    for (const p of BLOCKED) expect(isOrganizationPluginPath(p)).toBe(true);
    for (const p of ["/sign-in/email", "/sign-up/email", "/get-session", "/sign-out", "/organizations"]) {
      expect(isOrganizationPluginPath(p)).toBe(false);
    }
  });

  it.each(BLOCKED)("/api/auth%s → 403 sin tocar la BD", async (route) => {
    const method = route === "/organization/list-members" ? "GET" : "POST";
    const res = await getAuth().handler(
      new Request(`http://localhost:3000/api/auth${route}`, {
        method,
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          // Una cookie de sesión cualquiera: el bloqueo no depende de quién sea.
          cookie: "better-auth.session_token=cualquiera.firma",
        },
        body:
          method === "POST"
            ? JSON.stringify({ name: "Otra", slug: "otra", organizationId: "org_x", memberIdOrEmail: "a@b.c", email: "a@b.c", role: "asesor" })
            : undefined,
      })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("ORGANIZATION_API_DISABLED");
  });

  it("el plugin no deja crear ni borrar organizaciones", () => {
    const plugin = getAuth().options.plugins?.find((p) => p.id === "organization") as
      | { options?: { allowUserToCreateOrganization?: unknown; disableOrganizationDeletion?: unknown } }
      | undefined;
    expect(plugin?.options?.allowUserToCreateOrganization).toBe(false);
    expect(plugin?.options?.disableOrganizationDeletion).toBe(true);
  });

  it.each(ROLES)("el rol %s no tiene permisos del plugin (organización, miembros, invitaciones)", (role) => {
    const asks: Record<string, string[]>[] = [
      { organization: ["update"] },
      { organization: ["delete"] },
      { member: ["create"] },
      { member: ["update"] },
      { member: ["delete"] },
      { invitation: ["create"] },
      { invitation: ["cancel"] },
    ];
    for (const ask of asks) {
      expect(roles[role].authorize(ask).success, `${role} ${JSON.stringify(ask)}`).toBe(false);
    }
  });
});
