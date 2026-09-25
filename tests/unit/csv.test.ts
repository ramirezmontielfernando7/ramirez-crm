import { describe, expect, it } from "vitest";
import { CsvError, detectDelimiter, parseCsv, toCsv } from "@/lib/csv";

describe("021 — parseCsv", () => {
  it("básico, con número de línea por fila", () => {
    expect(parseCsv("name,phone\nAna,5215512345678\n")).toEqual([
      { line: 1, cells: ["name", "phone"] },
      { line: 2, cells: ["Ana", "5215512345678"] },
    ]);
  });

  it("comillas, comillas escapadas y salto de línea dentro de un campo", () => {
    const rows = parseCsv('name,notes\n"López, Ana","dijo ""hola""\nadiós"\nBeto,x\n');
    expect(rows[1]!.cells).toEqual(["López, Ana", 'dijo "hola"\nadiós']);
    // la fila siguiente empieza en la línea 4 (el campo ocupó dos líneas)
    expect(rows[2]).toEqual({ line: 4, cells: ["Beto", "x"] });
  });

  it("CRLF, BOM de Excel y última fila sin salto", () => {
    const rows = parseCsv("﻿name,phone\r\nAna,52155\r\nBeto,52166");
    expect(rows.map((r) => r.cells)).toEqual([
      ["name", "phone"],
      ["Ana", "52155"],
      ["Beto", "52166"],
    ]);
  });

  it("detecta `;` (Excel en español)", () => {
    expect(detectDelimiter("nombre;telefono;etiquetas\n")).toBe(";");
    expect(detectDelimiter('"a;b",c\n')).toBe(",");
    expect(parseCsv("nombre;telefono\nAna;521\n")[1]!.cells).toEqual(["Ana", "521"]);
  });

  it("comilla sin cerrar → error con la línea donde empezó", () => {
    try {
      parseCsv('name,phone\nAna,"5215\nBeto,1\n');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CsvError);
      expect((err as CsvError).line).toBe(2);
    }
  });

  it("texto pegado a una comilla de cierre → error, no se reinterpreta", () => {
    expect(() => parseCsv('name\n"Ana"x\n')).toThrow(CsvError);
  });
});

describe("021 — toCsv", () => {
  it("BOM, CRLF y escape", () => {
    const out = toCsv(["a", "b"], [["x,y", 'di "hola"'], [null, 3]]);
    expect(out).toBe('﻿a,b\r\n"x,y","di ""hola"""\r\n,3\r\n');
  });

  it("neutraliza fórmulas (inyección CSV)", () => {
    const out = toCsv(["name"], [["=HYPERLINK(\"http://x\")"], ["@SUM(A1)"], ["+1"]]);
    expect(out).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(out).toContain("'@SUM(A1)");
    expect(out).toContain("'+1");
  });

  it("ida y vuelta", () => {
    const rows = [["Ana López", "5215512345678", "VIP, Import: marzo.csv"]];
    const parsed = parseCsv(toCsv(["name", "phone", "tags"], rows));
    expect(parsed[1]!.cells).toEqual(rows[0]);
  });
});
