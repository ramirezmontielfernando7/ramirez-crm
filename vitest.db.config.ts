import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Pruebas contra un Postgres REAL (Fase 1 multitenant): aislamiento entre
 * organizaciones que un mock de SQL no puede demostrar. Corren con
 * `pnpm test:db` sobre una base cuyo nombre termina en `_test` (ver
 * tests/db/env.ts), migrada dos veces seguidas antes de empezar.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/db/env.ts"],
    // Una sola base compartida: los archivos no corren en paralelo.
    fileParallelism: false,
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
