import { DrizzleQueryError } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 021 — Una etiqueta con nombre repetido responde "duplicate" (409 en la
 * ruta), no un 500. Desde drizzle-orm 0.44 el error del driver llega envuelto
 * en DrizzleQueryError con el código de Postgres en `cause`: la prueba cubre
 * las dos formas.
 */

const { getDb, fallo } = vi.hoisted(() => ({ getDb: vi.fn(), fallo: { err: null as unknown } }));
vi.mock("@/lib/db", async () => {
  const { schema } = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  return { getDb, schema };
});
vi.mock("@/server/activity/log", () => ({ logActivitySafe: vi.fn() }));

import { createTag, TagError, updateTag } from "@/server/tags/tags";

/** Cadena de drizzle que termina rechazando en `.returning()`. */
function dbQueFalla() {
  const chain: Record<string, unknown> = {};
  for (const m of ["insert", "values", "update", "set", "where"]) chain[m] = () => chain;
  chain.returning = () => Promise.reject(fallo.err);
  return chain;
}

const pgUnique = () => Object.assign(new Error("duplicate key value"), { code: "23505" });

beforeEach(() => getDb.mockImplementation(dbQueFalla));

describe("etiqueta duplicada", () => {
  it.each([
    ["error crudo del driver (code en la raíz)", () => pgUnique()],
    [
      "DrizzleQueryError (code en cause, drizzle ≥ 0.44)",
      () => new DrizzleQueryError('insert into "contact_tag" …', ["org_1", "VIP"], pgUnique()),
    ],
  ])("crear con %s → TagError duplicate", async (_n, hacer) => {
    fallo.err = hacer();
    const err = await createTag("org_1", { name: "VIP" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TagError);
    expect((err as TagError).code).toBe("duplicate");
  });

  it("renombrar a un nombre existente (envuelto) → TagError duplicate", async () => {
    fallo.err = new DrizzleQueryError("update …", [], pgUnique());
    const err = await updateTag("org_1", "tag_1", { name: "VIP" }).catch((e: unknown) => e);
    expect((err as TagError).code).toBe("duplicate");
  });

  it("otro error de la base NO se disfraza de duplicado", async () => {
    fallo.err = new DrizzleQueryError("insert …", [], Object.assign(new Error("x"), { code: "23503" }));
    const err = await createTag("org_1", { name: "VIP" }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(TagError);
  });
});
