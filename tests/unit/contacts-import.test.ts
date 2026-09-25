import { describe, expect, it } from "vitest";
import {
  decodeCsvBytes,
  IMPORT_MAX_ROWS,
  ImportError,
  parseImportPhone,
  validateImport,
} from "@/server/contacts-io/validate";
import { importTagName } from "@/server/contacts-io/import";
import { parseWaConsent } from "@/lib/tags";

describe("021 — teléfono del CSV (misma regla que el alta manual)", () => {
  it("quita formato y normaliza 521→52 con normalizeMx", () => {
    expect(parseImportPhone("+52 1 (55) 1234-5678")).toEqual({ phone: "525512345678" });
    expect(parseImportPhone("5215512345678")).toEqual({ phone: "525512345678" });
    expect(parseImportPhone("00 34 612 345 678")).toEqual({ phone: "34612345678" });
  });

  it("rechaza con motivo específico", () => {
    expect(parseImportPhone("")).toEqual({ error: "Falta el teléfono" });
    expect(parseImportPhone("55-ABC-1234")).toMatchObject({ error: expect.stringMatching(/caracteres no válidos/) });
    expect(parseImportPhone("12345")).toMatchObject({ error: expect.stringMatching(/5 dígitos/) });
    expect(parseImportPhone("5512345678")).toMatchObject({ error: expect.stringMatching(/sin código de país/) });
  });
});

describe("021 — consentimiento del CSV", () => {
  it("formas comunes", () => {
    expect(parseWaConsent("opt_in")).toBe("opt_in");
    expect(parseWaConsent("Sí")).toBe("opt_in");
    expect(parseWaConsent("opt-out")).toBe("opt_out");
    expect(parseWaConsent("BAJA")).toBe("opt_out");
    expect(parseWaConsent("desconocido")).toBe("desconocido");
    expect(parseWaConsent("tal vez")).toBeNull();
  });
});

describe("021 — validateImport", () => {
  it("columnas en español, filas válidas, vacías, fallidas y repetidas", () => {
    const csv = [
      "Nombre;Teléfono;Fuente;Consentimiento;Etiquetas",
      "Ana;+52 1 55 1234 5678;anuncio;si;VIP, Clientes",
      ";;;;",
      "Beto;5512345678;;;",
      "Carla;525512345678;;;", // mismo número que Ana ya normalizado
      "Dani;5215599999999;tele;;",
      "Eva;5215588888888;;quizá;",
      ";5215577777777;;;",
      "Fer;5215566666666;;;",
    ].join("\n");
    const r = validateImport(csv);
    expect(r.totalRows).toBe(8);
    expect(r.emptyRows).toBe(1);
    expect(r.rows.map((x) => x.name)).toEqual(["Ana", "Fer"]);
    expect(r.rows[0]).toMatchObject({
      line: 2,
      phone: "525512345678",
      source: "anuncio",
      waConsent: "opt_in",
      tags: ["VIP", "Clientes"],
    });
    expect(r.rows[1]).toMatchObject({ waConsent: null, source: null, tags: [] });
    const byLine = Object.fromEntries(r.failures.map((f) => [f.line, f.reason]));
    expect(byLine[4]).toMatch(/sin código de país/);
    expect(byLine[5]).toMatch(/repetido.*línea 2/);
    expect(byLine[6]).toMatch(/Fuente no reconocida/);
    expect(byLine[7]).toMatch(/Consentimiento no reconocido/);
    expect(byLine[8]).toBe("Falta el nombre");
  });

  it("sin columna de consentimiento → null (queda desconocido)", () => {
    const r = validateImport("name,phone\nAna,5215512345678\n");
    expect(r.rows[0]!.waConsent).toBeNull();
    expect(r.columns).toEqual(["name", "phone"]);
  });

  it("errores de archivo con código y mensaje específico", () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return err instanceof ImportError ? `${err.code}: ${err.message}` : String(err);
      }
      return "sin error";
    };
    expect(code(() => validateImport("   \n"))).toMatch(/^empty/);
    expect(code(() => validateImport("nombre,correo\nAna,a@b.c\n"))).toMatch(
      /^missing_columns: Faltan columnas obligatorias: phone. Columnas encontradas: nombre, correo/
    );
    expect(code(() => validateImport('name,phone\n"Ana,5215512345678\n'))).toMatch(/^malformed: .*línea 2/);
    const big = "name,phone\n" + "Ana,5215512345678\n".repeat(IMPORT_MAX_ROWS + 1);
    expect(code(() => validateImport(big))).toMatch(/^too_many_rows/);
  });

  it("xlsx disfrazado → not_csv; Windows-1252 conserva acentos", () => {
    expect(() => decodeCsvBytes(new Uint8Array([0x50, 0x4b, 3, 4]))).toThrow(/Excel/);
    // "José" en Windows-1252: é = 0xE9 (UTF-8 inválido)
    const bytes = new Uint8Array([0x4a, 0x6f, 0x73, 0xe9]);
    expect(decodeCsvBytes(bytes)).toBe("José");
  });
});

describe("021 — etiqueta del import", () => {
  it("la que eligió el usuario o 'Import: archivo'", () => {
    expect(importTagName("clientes-marzo.csv")).toBe("Import: clientes-marzo.csv");
    expect(importTagName("x.csv", "  Base   Clínica  ")).toBe("Base Clínica");
    expect(importTagName("x.csv", "   ")).toBe("Import: x.csv");
    expect(importTagName("a".repeat(100) + ".csv").length).toBeLessThanOrEqual(60);
  });
});
