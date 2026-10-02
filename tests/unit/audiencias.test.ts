import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { cellToText, detectFileKind, readSpreadsheet } from "@/server/contacts-io/spreadsheet";
import { buildXlsx, SAMPLE_AUDIENCE_ROWS } from "@/server/contacts-io/xlsx-write";
import {
  detectColumns,
  ImportError,
  missingColumns,
  parseImportEmail,
  validateTable,
} from "@/server/contacts-io/validate";
import { AudienceError, previewAudienceFile, sanitizeMapping } from "@/server/campaigns/audiences";
import { toCsv } from "@/lib/csv";

const enc = (s: string) => new TextEncoder().encode(s);

describe("Campañas v2 — tipo de archivo", () => {
  it("acepta .xlsx y .csv; rechaza .xlsm, .xls y lo que no es hoja", () => {
    expect(detectFileKind("base.xlsx", buildXlsx("h", [["a"]]))).toBe("xlsx");
    expect(detectFileKind("base.CSV", enc("a,b"))).toBe("csv");
    expect(() => detectFileKind("base.xlsm", enc("PK"))).toThrow(/macros/);
    expect(() => detectFileKind("base.xls", enc("x"))).toThrow(/97-2003/);
    expect(() => detectFileKind("base.pdf", enc("x"))).toThrow(ImportError);
    expect(() => detectFileKind("base.xlsx", enc("nombre,numero"))).toThrow(/no lo es/);
    expect(() => detectFileKind("base.csv", buildXlsx("h", [["a"]]))).toThrow(/renómbralo/);
  });

  it("un .xlsx con macros (vbaProject.bin) se rechaza aunque diga .xlsx", async () => {
    const files = { "xl/workbook.xml": strToU8("<workbook/>"), "xl/vbaProject.bin": new Uint8Array([1, 2, 3]) };
    await expect(readSpreadsheet("base.xlsx", zipSync(files))).rejects.toMatchObject({ code: "macros" });
  });

  it("un zip que no es libro de Excel se rechaza", async () => {
    await expect(readSpreadsheet("base.xlsx", zipSync({ "hola.txt": strToU8("hola") }))).rejects.toMatchObject({
      code: "not_spreadsheet",
    });
  });
});

describe("Campañas v2 — lectura de Excel", () => {
  it("lee la primera hoja como texto (el archivo de ejemplo da la vuelta completa)", async () => {
    const { kind, table } = await readSpreadsheet("ejemplo.xlsx", buildXlsx("Contactos", SAMPLE_AUDIENCE_ROWS));
    expect(kind).toBe("xlsx");
    expect(table.header).toEqual(["nombre", "numero", "correo", "etiquetas"]);
    expect(table.rows[0]).toEqual({ line: 2, cells: ["Ana López", "5214621345678", "ana@ejemplo.mx", "clientes, vip"] });
    expect(table.rows[1]?.cells[2]).toBe("");
  });

  it("de una celda con fórmula se usa el VALOR guardado, nunca la fórmula", async () => {
    const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>nombre</t></is></c><c r="B1" t="inlineStr"><is><t>numero</t></is></c></row><row r="2"><c r="A2" t="str"><f>CONCAT("A","na")</f><v>Ana</v></c><c r="B2"><f>5214621345677+1</f><v>5214621345678</v></c></row></sheetData></worksheet>`;
    const base = buildXlsx("h", [["x"]]);
    const { unzipSync } = await import("fflate");
    const files = unzipSync(base);
    files["xl/worksheets/sheet1.xml"] = strToU8(sheet);
    const { table } = await readSpreadsheet("f.xlsx", zipSync(files));
    expect(table.rows[0]?.cells).toEqual(["Ana", "5214621345678"]);
  });

  it("celdas: número sin notación científica, fecha ISO, vacío", () => {
    expect(cellToText(5214621345678)).toBe("5214621345678");
    expect(cellToText(12.5)).toBe("12.5");
    expect(cellToText(new Date("2026-10-02T00:00:00Z"))).toBe("2026-10-02");
    expect(cellToText(null)).toBe("");
    expect(cellToText(true)).toBe("sí");
  });
});

describe("Campañas v2 — columnas por nombre y sinónimos", () => {
  it("reconoce nombre, numero/telefono/celular/whatsapp, correo/email y etiquetas/tags", () => {
    expect(detectColumns(["Nombre", "Celular", "E-mail", "Tags"])).toEqual({ name: 0, phone: 1, email: 2, tags: 3 });
    expect(detectColumns(["NOMBRE", "WhatsApp", "Correo electrónico"])).toEqual({ name: 0, phone: 1, email: 2 });
    expect(detectColumns(["cliente", "teléfono"])).toEqual({ name: 0, phone: 1 });
  });

  it("sin nombre o número reconocibles pide asignarlos", () => {
    expect(missingColumns(detectColumns(["Persona", "Móvil 1"]))).toEqual(["name", "phone"]);
  });

  it("la asignación del cliente se valida (índices de la hoja, sin repetir)", () => {
    expect(sanitizeMapping({ name: "0", phone: 1, email: "" }, 3)).toEqual({ name: 0, phone: 1 });
    expect(() => sanitizeMapping({ name: 0, phone: 7 }, 3)).toThrow(AudienceError);
    expect(() => sanitizeMapping({ name: 0, phone: 0 }, 3)).toThrow(/dos campos/);
    expect(sanitizeMapping(undefined, 3)).toBeNull();
  });
});

describe("Campañas v2 — validación de filas", () => {
  const table = {
    header: ["Persona", "Móvil 1", "correo", "cupón"],
    rows: [
      { line: 2, cells: ["Ana", "5214621345678", "ANA@x.mx", "A10"] },
      { line: 3, cells: ["Beto", "4621345678", "", "B20"] },
      { line: 4, cells: ["Ana bis", "+52 1 462 134 5678", "", ""] },
      { line: 5, cells: ["Ceci", "5215512345678", "no-es-correo", "C30"] },
      { line: 6, cells: ["", "", "", ""] },
    ],
  };

  it("con la asignación elegida: válidas, inválidas, duplicadas, vacías, correo y columnas extra", () => {
    const v = validateTable(table, { name: 0, phone: 1, email: 2 });
    expect(v.rows.map((r) => r.line)).toEqual([2, 5]);
    expect(v.rows[0]).toMatchObject({ phone: "524621345678", email: "ana@x.mx", extra: { cupón: "A10" } });
    expect(v.failures.map((f) => [f.line, f.kind])).toEqual([
      [3, "invalid"],
      [4, "duplicate"],
    ]);
    expect(v.failures[0]?.reason).toMatch(/sin código de país/);
    expect(v.emptyRows).toBe(1);
    expect(v.extraColumns).toEqual(["cupón"]);
    // Un correo inválido no tumba la fila: entra sin correo y con aviso.
    expect(v.rows[1]?.email).toBeNull();
    expect(v.warnings[0]).toMatchObject({ line: 5, reason: expect.stringMatching(/Correo no válido/) });
  });

  it("sin nombre o número asignados no valida", () => {
    expect(() => validateTable(table, { name: 0 })).toThrow(/número de whatsapp/i);
  });

  it("correo", () => {
    expect(parseImportEmail(" Ana@Ejemplo.MX ")).toBe("ana@ejemplo.mx");
    expect(parseImportEmail("ana@ejemplo")).toBeNull();
    expect(parseImportEmail("ana ejemplo.mx")).toBeNull();
  });
});

describe("Campañas v2 — vista previa", () => {
  it("encabezados desconocidos: pide asignar y no resume", async () => {
    const csv = "Persona,Móvil 1\nAna,5214621345678\n";
    const p = await previewAudienceFile({ fileName: "b.csv", bytes: enc(csv) });
    expect(p.missing).toEqual(["name", "phone"]);
    expect(p.summary).toBeNull();
    expect(p.sample[0]?.cells).toEqual(["Ana", "5214621345678"]);
  });

  it("con asignación: resumen y filas inválidas marcadas", async () => {
    const csv = "Persona,Móvil 1\nAna,5214621345678\nBeto,123\nAna2,5214621345678\n";
    const p = await previewAudienceFile({ fileName: "b.csv", bytes: enc(csv), mapping: { name: 0, phone: 1 } });
    expect(p.missing).toEqual([]);
    expect(p.summary).toEqual({ totalRows: 3, valid: 1, invalid: 1, duplicate: 1, empty: 0, warnings: 0 });
    expect(p.sample.map((r) => [r.line, r.error !== null, r.duplicate])).toEqual([
      [2, false, false],
      [3, true, false],
      [4, true, true],
    ]);
  });
});

describe("Campañas v2 — descarga de filas con error", () => {
  it("protege contra inyección de fórmulas en CSV", () => {
    const csv = toCsv(["nombre"], [["=HYPERLINK(\"x\")"], ["+1"], ["-2"], ["@SUM(A1)"]]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'-2");
    expect(csv).toContain("'@SUM");
  });
});
