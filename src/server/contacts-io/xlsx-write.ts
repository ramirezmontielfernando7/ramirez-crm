import { strToU8, zipSync } from "fflate";

/**
 * Campañas v2 (PR 2) — Un .xlsx mínimo (una hoja, solo texto), para el
 * archivo de ejemplo de Audiencias. Todas las celdas van como texto: así un
 * teléfono no se vuelve "5.21E+12" ni un "=…" se vuelve fórmula al abrirlo.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 no admite caracteres de control.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function colName(i: number): string {
  let n = i + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function buildXlsx(sheetName: string, rows: string[][]): Uint8Array {
  const sheetRows = rows
    .map(
      (r, i) =>
        `<row r="${i + 1}">${r
          .map((c, j) => `<c r="${colName(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`)
          .join("")}</row>`
    )
    .join("");
  const name = esc(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, " ")) || "Hoja1";
  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    ),
  });
}

/** El archivo de ejemplo de Audiencias: columnas esperadas y dos filas. */
export const SAMPLE_AUDIENCE_ROWS: string[][] = [
  ["nombre", "numero", "correo", "etiquetas"],
  ["Ana López", "5214621345678", "ana@ejemplo.mx", "clientes, vip"],
  ["Carlos Ruiz", "+52 55 1234 5678", "", "prospectos"],
];
