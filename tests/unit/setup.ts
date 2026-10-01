import { vi } from "vitest";

/**
 * Fase 3, PR 2 — Las pruebas unitarias corren con BD falsa o sin BD. El
 * estado de la organización (activa / suspendida) se lee de la BD real con el
 * pool de sistema, así que aquí toda organización está ACTIVA salvo que la
 * prueba diga otra cosa. Lo que de verdad pasa con una organización
 * suspendida lo prueban `tests/db/plataforma.test.ts` (Postgres real) y
 * `scripts/e2e-plataforma.mjs`.
 */
vi.mock("@/server/platform-admin/org-status", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/platform-admin/org-status")>();
  return {
    ...real,
    getOrgStatus: vi.fn(async () => "active" as const),
    isOrgActive: vi.fn(async () => true),
    assertOrgActive: vi.fn(async () => undefined),
  };
});
