import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { describeError } from "@/lib/log-safe";

/**
 * Constitución I: nada sensible en logs. Con drizzle ≥ 0.44 el error trae el
 * SQL y sus parámetros; el de Postgres, los valores de la llave en `detail`.
 */

const TELEFONO = "5215512345678";
const TEXTO = "hola, mi tarjeta es 4111";

function pgError(extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`duplicate key value violates unique constraint "contact_wa_identity"`), {
    code: "23505",
    severity: "ERROR",
    table_name: "contact",
    constraint_name: "contact_org_wa_identity_uq",
    detail: `Key (wa_identity)=(${TELEFONO}) already exists.`,
    ...extra,
  });
}

describe("describeError", () => {
  it("DrizzleQueryError: solo código, tabla y restricción — sin SQL ni parámetros", () => {
    const err = new DrizzleQueryError(
      'insert into "message" ("body", "phone") values ($1, $2)',
      [TEXTO, TELEFONO],
      pgError()
    );
    const s = describeError(err);
    expect(s).toBe(
      "error de base de datos (código 23505, tabla contact, restricción contact_org_wa_identity_uq)"
    );
    expect(s).not.toContain(TELEFONO);
    expect(s).not.toContain(TEXTO);
    expect(s).not.toMatch(/insert|values|\$1/i);
  });

  it("error crudo de Postgres: sin `detail` (trae los valores de la llave)", () => {
    const s = describeError(pgError());
    expect(s).toContain("código 23505");
    expect(s).not.toContain(TELEFONO);
  });

  it("DrizzleQueryError sin causa: no inventa nada ni filtra el query", () => {
    const s = describeError(new DrizzleQueryError("select secret", [TELEFONO]));
    expect(s).toBe("error de base de datos (código desconocido)");
  });

  it("otros errores: nombre + primera línea del mensaje, recortada", () => {
    expect(describeError(new TypeError("x is undefined\n    at foo (bar.ts:1)"))).toBe(
      "TypeError: x is undefined"
    );
    expect(describeError(new Error("a".repeat(500))).length).toBeLessThan(220);
  });

  it("no-objetos", () => {
    expect(describeError("boom")).toBe("boom");
    expect(describeError(undefined)).toBe("undefined");
  });
});
