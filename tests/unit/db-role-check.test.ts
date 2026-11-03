import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoría DF-12 — al arrancar se comprueba que la app conecte con un
 * usuario que respeta el aislamiento entre empresas (RLS).
 */

const { fila } = vi.hoisted(() => ({ fila: { current: null as null | { user: string; superuser: boolean; bypass: boolean } } }));
vi.mock("@/lib/db", () => ({ getSql: () => async () => (fila.current ? [fila.current] : []) }));

import { checkDbRole, lastDbRoleCheck } from "@/server/db-role-check";

const prev = process.env.DB_ROLE_STRICT;
beforeEach(() => {
  delete process.env.DB_ROLE_STRICT;
});
afterEach(() => {
  if (prev === undefined) delete process.env.DB_ROLE_STRICT;
  else process.env.DB_ROLE_STRICT = prev;
});

describe("DF-12: usuario de la base de la app", () => {
  it("vocero_app (sin superusuario ni BYPASSRLS) → seguro", async () => {
    fila.current = { user: "vocero_app", superuser: false, bypass: false };
    expect(await checkDbRole()).toMatchObject({ safe: true });
    expect(lastDbRoleCheck()?.safe).toBe(true);
  });

  it("postgres (superusuario) → no seguro: avisa y sigue", async () => {
    fila.current = { user: "postgres", superuser: true, bypass: true };
    expect(await checkDbRole()).toMatchObject({ safe: false, superuser: true });
    expect(lastDbRoleCheck()?.safe).toBe(false);
  });

  it("con DB_ROLE_STRICT=true, un usuario con BYPASSRLS no deja arrancar", async () => {
    process.env.DB_ROLE_STRICT = "true";
    fila.current = { user: "otro", superuser: false, bypass: true };
    await expect(checkDbRole()).rejects.toThrow(/aislamiento entre empresas/);
  });
});
