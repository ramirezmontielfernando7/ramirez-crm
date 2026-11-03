import { spawn } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

/**
 * Auditoría DF-16 — dos arranques a la vez no migran en paralelo: el segundo
 * espera el candado del primero y termina bien; si alguien lo retiene más
 * del tope, el arranque falla claro en vez de migrar encima.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIGRATE_URL = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL!;
const LOCK_KEY = 0x6d696772; // el mismo de scripts/migrate.mjs

function migrar(extra: Record<string, string> = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/migrate.mjs"], {
      cwd: ROOT,
      env: { ...process.env, MIGRATIONS_DIR: "drizzle", ...extra },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    child.on("close", (code) => resolve({ code, out }));
  });
}

describe("DF-16: candado global del migrador", () => {
  it("dos migradores a la vez terminan los dos bien (uno espera al otro)", async () => {
    const [a, b] = await Promise.all([migrar(), migrar()]);
    expect(a.code, a.out).toBe(0);
    expect(b.code, b.out).toBe(0);
  }, 60_000);

  it("con el candado retenido más del tope, el arranque falla con un mensaje claro", async () => {
    const sql = postgres(MIGRATE_URL, { max: 1, onnotice: () => {} });
    try {
      const [row] = await sql`select pg_try_advisory_lock(${LOCK_KEY}) as ok`;
      expect(row?.ok).toBe(true);
      const r = await migrar({ MIGRATE_LOCK_TIMEOUT_MS: "1500" });
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/otro arranque está migrando/);
      expect(r.out).toMatch(/candado de migraciones/);
    } finally {
      await sql.end();
    }
  }, 60_000);
});
