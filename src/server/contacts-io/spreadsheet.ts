import { unzipSync } from "fflate";
import readXlsxFile from "read-excel-file/node";
import { csvToTable, decodeCsvBytes, ImportError, type ImportTable } from "@/server/contacts-io/validate";

/**
 * Campañas v2 (PR 2) — Lee una base de contactos de .xlsx o .csv a una hoja
 * de texto (`ImportTable`) que valida `validateTable`.
 *
 * Excel con `read-excel-file` (local, MIT; `pnpm audit` limpio al elegirla):
 * lee el VALOR guardado de cada celda, nunca evalúa fórmulas. Antes de
 * abrirlo se revisa el zip con `fflate` sin descomprimir:
 * - con macros (`vbaProject.bin`, .xlsm) se rechaza;
 * - más de 50 MB descomprimido se rechaza (bomba zip: 5 MB pueden inflarse
 *   a gigas).
 * Solo se lee la PRIMERA hoja.
 */

const XLSX_MAX_UNCOMPRESSED = 50 * 1024 * 1024;

export type FileKind = "csv" | "xlsx";

/** El tipo por la extensión y los primeros bytes (un .xlsx es un zip: "PK"). */
export function detectFileKind(fileName: string, bytes: Uint8Array): FileKind {
  const lower = fileName.toLowerCase();
  if (/\.(xlsm|xltm|xlam)$/.test(lower)) {
    throw new ImportError("macros", "Los archivos de Excel con macros (.xlsm) no se aceptan: guárdalo como .xlsx");
  }
  if (/\.xls$/.test(lower)) {
    throw new ImportError("not_spreadsheet", "El formato .xls (Excel 97-2003) no se acepta: guárdalo como .xlsx o .csv");
  }
  const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (/\.xlsx$/.test(lower)) {
    if (!isZip) throw new ImportError("not_spreadsheet", "El archivo dice ser .xlsx pero no lo es: vuelve a guardarlo desde Excel");
    return "xlsx";
  }
  if (/\.(csv|txt)$/.test(lower)) {
    if (isZip) throw new ImportError("not_csv", "Es un archivo de Excel con extensión .csv: renómbralo a .xlsx o guárdalo como CSV UTF-8");
    return "csv";
  }
  throw new ImportError("not_spreadsheet", "Sube un archivo .xlsx o .csv");
}

/** Revisa el zip SIN descomprimir: macros y tamaño inflado. */
function inspectXlsx(bytes: Uint8Array): void {
  let total = 0;
  let hasMacros = false;
  let hasWorkbook = false;
  try {
    unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        const name = f.name.toLowerCase();
        if (name.endsWith("vbaproject.bin")) hasMacros = true;
        if (name === "xl/workbook.xml") hasWorkbook = true;
        return false; // no se descomprime nada aquí
      },
    });
  } catch {
    throw new ImportError("not_spreadsheet", "El archivo de Excel está dañado o no es un .xlsx");
  }
  if (hasMacros) {
    throw new ImportError("macros", "El archivo trae macros: guárdalo como .xlsx sin macros");
  }
  if (!hasWorkbook) {
    throw new ImportError("not_spreadsheet", "El archivo no es un libro de Excel (.xlsx)");
  }
  if (total > XLSX_MAX_UNCOMPRESSED) {
    throw new ImportError("too_large", "El archivo de Excel es demasiado grande al abrirlo: divídelo en varios");
  }
}

/** Una celda de Excel → texto, como la vería la persona. */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    // Teléfonos guardados como número: sin notación científica ni ".0".
    return Number.isInteger(value) ? BigInt(Math.round(value)).toString() : String(value);
  }
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value);
}

async function xlsxToTable(bytes: Uint8Array): Promise<ImportTable> {
  inspectXlsx(bytes);
  let sheets: { sheet: string; data: unknown[][] }[];
  try {
    sheets = (await readXlsxFile(Buffer.from(bytes))) as { sheet: string; data: unknown[][] }[];
  } catch {
    throw new ImportError("not_spreadsheet", "No se pudo leer el archivo de Excel: ábrelo y guárdalo de nuevo como .xlsx");
  }
  const data = sheets[0]?.data ?? [];
  // La primera fila con algo escrito es el encabezado.
  const start = data.findIndex((r) => r.some((c) => cellToText(c).trim() !== ""));
  if (start === -1) throw new ImportError("empty", "La primera hoja del archivo está vacía");
  const header = (data[start] ?? []).map(cellToText);
  const width = Math.max(header.length, ...data.map((r) => r.length));
  const rows = data.slice(start + 1).map((r, i) => ({
    line: start + 2 + i,
    cells: Array.from({ length: width }, (_, j) => cellToText(r[j])),
  }));
  return { header: Array.from({ length: width }, (_, j) => header[j] ?? ""), rows };
}

/** .xlsx o .csv → hoja de texto. */
export async function readSpreadsheet(
  fileName: string,
  bytes: Uint8Array
): Promise<{ kind: FileKind; table: ImportTable }> {
  if (bytes.length === 0) throw new ImportError("empty", "El archivo está vacío");
  const kind = detectFileKind(fileName, bytes);
  if (kind === "xlsx") return { kind, table: await xlsxToTable(bytes) };
  return { kind, table: csvToTable(decodeCsvBytes(bytes)) };
}
