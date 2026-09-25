/**
 * 021 — CSV sin dependencias (RFC 4180 + lo que de verdad exporta Excel).
 *
 * - Comillas dobles con `""` escapado y saltos de línea DENTRO de un campo.
 * - `\r\n`, `\n` o `\r` como fin de fila.
 * - BOM de UTF-8 al inicio (Excel lo pone al "Guardar como CSV UTF-8").
 * - Separador `,` o `;` (Excel en español usa `;`), detectado en la cabecera.
 *
 * Un CSV mal formado (comilla sin cerrar, texto pegado a una comilla de
 * cierre) NO se "arregla": se reporta con su línea, porque una fila
 * reinterpretada en silencio es un contacto con datos equivocados.
 */

export class CsvError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = "CsvError";
    this.line = line;
  }
}

export type CsvRow = { line: number; cells: string[] };

export function detectDelimiter(text: string): "," | ";" {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  // Fuera de comillas: una cabecera `"nombre, completo";telefono` es de `;`.
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ",") commas++;
    else if (!quoted && ch === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

/** Filas con su número de línea de inicio (1 = cabecera). */
export function parseCsv(input: string, delimiter?: "," | ";"): CsvRow[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = delimiter ?? detectDelimiter(text);
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowStart = 1;

  const endRow = () => {
    cells.push(cell);
    rows.push({ line: rowStart, cells });
    cells = [];
    cell = "";
    afterQuote = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (cell.trim() !== "" || afterQuote) {
        throw new CsvError("Comilla en medio de un campo: encierra el campo completo entre comillas", line);
      }
      cell = "";
      quoted = true;
      continue;
    }
    if (ch === sep) {
      cells.push(cell);
      cell = "";
      afterQuote = false;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowStart = line;
      continue;
    }
    if (afterQuote) {
      if (ch === " " || ch === "\t") continue;
      throw new CsvError("Texto después de una comilla de cierre", line);
    }
    cell += ch;
  }
  if (quoted) throw new CsvError("Comilla sin cerrar", rowStart);
  if (cell !== "" || cells.length > 0 || afterQuote) endRow();
  return rows;
}

/**
 * Celda segura para abrir en Excel/Sheets: un nombre que empiece con `=`,
 * `+`, `-` o `@` se ejecutaría como fórmula (inyección CSV). Se antepone un
 * apóstrofo, que la hoja oculta.
 */
function csvCell(value: string | number | null | undefined): string {
  let v = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Serializa a CSV con BOM (para que Excel respete los acentos) y `\r\n`. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
