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

/**
 * Fase 3, PR 3 — Los módulos por organización también se leen de la BD real.
 * Aquí cada organización tiene lo que dicen las variables de entorno (lo
 * mismo que una organización sin fila), así que las pruebas que encienden o
 * apagan `AGENDA`, `CAMPAIGNS`… con `vi.stubEnv` siguen valiendo. Lo que pasa
 * con dos organizaciones distintas lo prueban `tests/db/modulos.test.ts` y
 * `scripts/e2e-modulos.mjs`.
 */
vi.mock("@/server/modules/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/modules/store")>();
  const { envModuleDefaults } = await import("@/server/modules/defaults");
  return {
    ...real,
    getOrgModules: vi.fn(async () => envModuleDefaults()),
    anyOrgHasChannel: vi.fn(async (channel: string) =>
      envModuleDefaults().channels.has(channel as "whatsapp")
    ),
  };
});
