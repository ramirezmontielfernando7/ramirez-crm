import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { PLATFORM_TABLES } from "@/lib/db/platform-tables";

/**
 * Fase 1 multitenant (H23) — toda tabla es de una organización o está
 * declarada, con su motivo, como tabla de PLATAFORMA.
 *
 * Si estás aquí porque agregaste una tabla y esto se puso rojo: casi seguro
 * le falta `organizationId: text("organization_id").notNull().references(() =>
 * organization.id, { onDelete: "cascade" })`. Solo si la tabla de verdad no
 * pertenece a ningún negocio (auth, plataforma) va en `PLATFORM_TABLES`
 * (`src/lib/db/platform-tables.ts`), con el porqué.
 */

const tables = Object.values(schema)
  .filter((v: unknown): v is PgTable => v instanceof PgTable)
  .map((t) => getTableConfig(t));

describe("esquema multitenant", () => {
  it("el detector ve las tablas del esquema", () => {
    // Si drizzle cambiara la forma de exportar, esto evita un verde vacío.
    expect(tables.length).toBeGreaterThan(40);
  });

  it("toda tabla de dominio tiene organization_id NOT NULL con FK a organization", () => {
    const faltan: string[] = [];
    for (const t of tables) {
      if (t.name in PLATFORM_TABLES) continue;
      const col = t.columns.find((c) => c.name === "organization_id");
      if (!col || !col.notNull) {
        faltan.push(`${t.name}: sin organization_id NOT NULL`);
        continue;
      }
      const fk = t.foreignKeys.some((f) => {
        const ref = f.reference();
        return (
          ref.columns.some((c) => c.name === "organization_id") &&
          getTableConfig(ref.foreignTable).name === "organization"
        );
      });
      if (!fk) faltan.push(`${t.name}: organization_id sin FK a organization`);
    }
    expect(faltan, faltan.join("\n")).toEqual([]);
  });

  it("la lista de plataforma no tiene tablas que ya no existen", () => {
    const nombres = new Set(tables.map((t) => t.name));
    const sobran = Object.keys(PLATFORM_TABLES).filter((n) => !nombres.has(n));
    expect(sobran).toEqual([]);
  });

  it("ninguna tabla de plataforma tiene organization_id (si lo tiene, es de dominio)", () => {
    const mal = tables
      .filter((t) => t.name in PLATFORM_TABLES)
      .filter((t) => t.columns.some((c) => c.name === "organization_id"))
      .map((t) => t.name);
    expect(mal).toEqual([]);
  });
});
