import { CsvError, parseCsv } from "@/lib/csv";
import { normalizeMx } from "@/lib/meta/client";
import { normalizeTagName, parseWaConsent, type WaConsent } from "@/lib/tags";
import { SOURCE_VALUES } from "@/server/contact-source";
import type { SourceValue } from "@/lib/types";
import { IMPORT_COLUMN_LABEL, type ImportColumn } from "@/lib/audiences";

/**
 * 021 — Validación de un CSV de contactos, SIN base de datos.
 *
 * Todo lo que puede estar mal en una fila se decide aquí, con un motivo
 * concreto por fila; la capa de BD (`import.ts`) solo recibe filas válidas.
 */

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 20_000;

export class ImportError extends Error {
  code:
    | "too_large"
    | "empty"
    | "malformed"
    | "missing_columns"
    | "too_many_rows"
    | "not_csv"
    | "not_spreadsheet"
    | "macros";
  constructor(code: ImportError["code"], message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}

export const IMPORT_ERROR_STATUS: Record<ImportError["code"], number> = {
  too_large: 413,
  empty: 422,
  malformed: 422,
  missing_columns: 422,
  too_many_rows: 413,
  not_csv: 415,
  not_spreadsheet: 415,
  macros: 415,
};

/** Columna canónica → encabezados aceptados (sin acentos, minúsculas, sin separadores). */
const HEADER_ALIASES: Record<ImportColumn, string[]> = {
  name: ["name", "nombre", "nombrecompleto", "cliente"],
  phone: ["phone", "telefono", "tel", "celular", "movil", "whatsapp", "numero"],
  source: ["source", "fuente", "origen"],
  waConsent: ["waconsent", "consent", "consentimiento", "optin"],
  waConsentSource: [
    "waconsentsource",
    "consentsource",
    "origenconsentimiento",
    "fuenteconsentimiento",
  ],
  tags: ["tags", "etiquetas", "etiqueta", "tag"],
  // Campañas v2 (PR 2): correo opcional.
  email: ["email", "correo", "correoelectronico", "mail", "emailaddress"],
};

export { IMPORT_COLUMNS, IMPORT_COLUMN_LABEL, type ImportColumn } from "@/lib/audiences";

/** Columna del archivo (índice) que corresponde a cada campo. */
export type ColumnMapping = Partial<Record<ImportColumn, number>>;

/** Una hoja ya leída (de CSV o de Excel): encabezados y filas de texto. */
export type ImportTable = {
  header: string[];
  rows: { line: number; cells: string[] }[];
};

function headerKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export type ValidRow = {
  line: number;
  name: string;
  /** Teléfono normalizado (521→52): también es la identidad de WhatsApp. */
  phone: string;
  source: SourceValue | null;
  /** null = el CSV no dijo nada (queda `desconocido` o lo que ya tenía). */
  waConsent: WaConsent | null;
  waConsentSource: string | null;
  tags: string[];
  /** Campañas v2: correo válido o null (uno inválido se ignora con aviso). */
  email: string | null;
  /** Campañas v2: columnas del archivo que no son campos (sirven como variables). */
  extra: Record<string, string>;
};

export type RowFailure = {
  line: number;
  name: string;
  phone: string;
  reason: string;
  /** `duplicate` = teléfono repetido en el mismo archivo; lo demás, inválido. */
  kind?: "invalid" | "duplicate";
};

export type ValidationResult = {
  rows: ValidRow[];
  failures: RowFailure[];
  /** Filas que sí entran pero con una salvedad (p. ej. correo inválido ignorado). */
  warnings: RowFailure[];
  emptyRows: number;
  totalRows: number;
  columns: ImportColumn[];
  /** Nombres de las columnas extra, en el orden del archivo. */
  extraColumns: string[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Correo tal cual lo escribe la gente → minúsculas, o null si no parece correo. */
export function parseImportEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v || v.length > 254 || !EMAIL_RE.test(v)) return null;
  return v;
}

/**
 * Teléfono tal como lo escribe la gente ("+52 (462) 134-5678") → dígitos, con
 * la MISMA regla que el alta manual: código de país obligatorio, 7 a 15
 * dígitos, y la normalización 521→52 de `normalizeMx` (la que usa todo el
 * sistema para la identidad de WhatsApp).
 */
export function parseImportPhone(raw: string): { phone: string } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "Falta el teléfono" };
  const withoutFormat = trimmed.replace(/[\s().\- ]/g, "").replace(/^\+/, "").replace(/^00/, "");
  if (!/^\d+$/.test(withoutFormat)) {
    return { error: `Teléfono con caracteres no válidos: "${trimmed.slice(0, 30)}"` };
  }
  if (withoutFormat.length < 7 || withoutFormat.length > 15) {
    return { error: `Teléfono de ${withoutFormat.length} dígitos: debe tener entre 7 y 15, con código de país` };
  }
  if (withoutFormat.length === 10) {
    // Diez dígitos es un número nacional de varios países: sin código de país
    // no se sabe a quién pertenece, y adivinar produce un número equivocado.
    return { error: "Parece un número sin código de país (10 dígitos): agrega la lada internacional, ej. 52 para México" };
  }
  return { phone: normalizeMx(withoutFormat) };
}

function parseSource(raw: string): SourceValue | null | { error: string } {
  const v = headerKey(raw);
  if (!v) return null;
  const alias: Record<string, SourceValue> = { organico: "organico", contenidoorganico: "organico", ad: "anuncio", ads: "anuncio" };
  const found = (SOURCE_VALUES as readonly string[]).includes(v) ? (v as SourceValue) : alias[v];
  if (!found) {
    return { error: `Fuente no reconocida "${raw.trim().slice(0, 30)}": usa ${SOURCE_VALUES.join(", ")}` };
  }
  return found;
}

export function decodeCsvBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    throw new ImportError("not_csv", "Es un archivo de Excel (.xlsx), no un CSV: ábrelo y usa Guardar como → CSV UTF-8");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Excel en Windows guarda "CSV" en Windows-1252: se respeta en vez de
    // convertir los acentos en basura.
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** CSV → hoja de texto (sin validar filas). */
export function csvToTable(text: string): ImportTable {
  if (!text.trim()) throw new ImportError("empty", "El archivo está vacío");
  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (err) {
    if (err instanceof CsvError) {
      throw new ImportError("malformed", `CSV mal formado en la línea ${err.line}: ${err.message}`);
    }
    throw err;
  }
  const [header, ...body] = parsed;
  if (!header) throw new ImportError("empty", "El archivo está vacío");
  return { header: header.cells, rows: body };
}

/** Reconoce cada campo por el nombre de su columna y sus sinónimos. */
export function detectColumns(header: string[]): ColumnMapping {
  const index: ColumnMapping = {};
  header.forEach((cell, i) => {
    const key = headerKey(cell);
    for (const [col, aliases] of Object.entries(HEADER_ALIASES) as [ImportColumn, string[]][]) {
      if (aliases.includes(key) && index[col] === undefined) index[col] = i;
    }
  });
  return index;
}

/** Los campos obligatorios que la asignación no cubre. */
export function missingColumns(mapping: ColumnMapping): ImportColumn[] {
  return (["name", "phone"] as const).filter((c) => mapping[c] === undefined);
}

/** CSV de la importación de Contactos: columnas reconocidas por nombre. */
export function validateImport(text: string): ValidationResult {
  const table = csvToTable(text);
  const mapping = detectColumns(table.header);
  const missing = missingColumns(mapping);
  if (missing.length > 0) {
    const seen = table.header.map((c) => c.trim()).filter(Boolean).slice(0, 10).join(", ") || "(ninguna)";
    throw new ImportError(
      "missing_columns",
      `Faltan columnas obligatorias: ${missing.join(" y ")}. Columnas encontradas: ${seen}`
    );
  }
  return validateTable(table, mapping);
}

/**
 * Valida cada fila de una hoja con la asignación de columnas dada (la
 * reconocida o la que eligió la persona en "¿qué es cada columna?").
 */
export function validateTable(table: ImportTable, mapping: ColumnMapping): ValidationResult {
  const missing = missingColumns(mapping);
  if (missing.length > 0) {
    throw new ImportError(
      "missing_columns",
      `Falta indicar qué columna es ${missing.map((c) => IMPORT_COLUMN_LABEL[c].toLowerCase()).join(" y cuál es ")}`
    );
  }
  const body = table.rows;
  if (body.length > IMPORT_MAX_ROWS) {
    throw new ImportError(
      "too_many_rows",
      `El archivo tiene ${body.length.toLocaleString("es-MX")} filas; el máximo es ${IMPORT_MAX_ROWS.toLocaleString("es-MX")}. Divídelo en varios archivos.`
    );
  }
  const index = mapping;
  const mapped = new Set(Object.values(index));
  const extraIdx: { i: number; name: string }[] = [];
  const usedExtra = new Set<string>();
  table.header.forEach((h, i) => {
    const name = h.trim().slice(0, 40);
    if (mapped.has(i) || !name || usedExtra.has(name.toLowerCase())) return;
    usedExtra.add(name.toLowerCase());
    extraIdx.push({ i, name });
  });

  const get = (cells: string[], col: ImportColumn) =>
    index[col] === undefined ? "" : (cells[index[col]!] ?? "").trim();

  const rows: ValidRow[] = [];
  const failures: RowFailure[] = [];
  const warnings: RowFailure[] = [];
  const firstLineByPhone = new Map<string, number>();
  let emptyRows = 0;

  for (const { line, cells } of body) {
    if (cells.every((c) => c.trim() === "")) {
      emptyRows++;
      continue;
    }
    const name = get(cells, "name");
    const rawPhone = get(cells, "phone");
    const fail = (reason: string, kind: RowFailure["kind"] = "invalid") =>
      failures.push({ line, name, phone: rawPhone, reason, kind });

    if (!name) {
      fail("Falta el nombre");
      continue;
    }
    if (name.length > 120) {
      fail("Nombre de más de 120 caracteres");
      continue;
    }
    const phone = parseImportPhone(rawPhone);
    if ("error" in phone) {
      fail(phone.error);
      continue;
    }
    const firstLine = firstLineByPhone.get(phone.phone);
    if (firstLine !== undefined) {
      fail(`Teléfono repetido en el archivo (ya aparece en la línea ${firstLine})`, "duplicate");
      continue;
    }
    const source = parseSource(get(cells, "source"));
    if (source && typeof source === "object") {
      fail(source.error);
      continue;
    }
    const rawConsent = get(cells, "waConsent");
    const waConsent = rawConsent ? parseWaConsent(rawConsent) : null;
    if (rawConsent && !waConsent) {
      fail(`Consentimiento no reconocido "${rawConsent.slice(0, 30)}": usa opt_in, opt_out o desconocido`);
      continue;
    }
    const tagNames: string[] = [];
    let badTag: string | null = null;
    for (const raw of get(cells, "tags").split(/[,|]/)) {
      if (!raw.trim()) continue;
      const tag = normalizeTagName(raw);
      if (!tag) {
        badTag = raw.trim();
        break;
      }
      if (!tagNames.includes(tag)) tagNames.push(tag);
    }
    if (badTag !== null) {
      fail(`Etiqueta de más de 60 caracteres: "${badTag.slice(0, 30)}…"`);
      continue;
    }
    const rawEmail = get(cells, "email");
    const email = rawEmail ? parseImportEmail(rawEmail) : null;
    if (rawEmail && !email) {
      warnings.push({
        line,
        name,
        phone: rawPhone,
        reason: `Correo no válido "${rawEmail.slice(0, 40)}": se importó sin correo`,
        kind: "invalid",
      });
    }
    const extra: Record<string, string> = {};
    for (const { i, name: col } of extraIdx) {
      const v = (cells[i] ?? "").trim();
      if (v) extra[col] = v.slice(0, 500);
    }

    firstLineByPhone.set(phone.phone, line);
    rows.push({
      line,
      name,
      phone: phone.phone,
      source,
      waConsent,
      waConsentSource: get(cells, "waConsentSource").slice(0, 200) || null,
      tags: tagNames,
      email,
      extra,
    });
  }

  return {
    rows,
    failures,
    warnings,
    emptyRows,
    totalRows: body.length,
    columns: Object.keys(index) as ImportColumn[],
    extraColumns: extraIdx.map((e) => e.name),
  };
}
