/**
 * El mock de WhatsApp valida los parámetros del cuerpo de una plantilla como
 * Meta: si no cuadran con las variables de la plantilla aprobada, 132000.
 * Puro (sin estado del mock) para probarlo sin levantar la app.
 *
 * - POSITIONAL ({{1}}…): tantos parámetros como el índice más alto, sin
 *   `parameter_name`.
 * - NAMED ({{nombre}}…): un parámetro por nombre distinto, cada uno con su
 *   `parameter_name`; mandarlos como posicionales es justo el 132000 que
 *   devuelve Meta con plantillas creadas fuera del CRM.
 */

const ANY_VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

type SentParameter = { type?: string; text?: string; parameter_name?: string };

/** `parameter_format` como lo reporta Meta al listar plantillas. */
export function mockParameterFormat(body: string): "NAMED" | "POSITIONAL" {
  return [...body.matchAll(ANY_VARIABLE)].some((m) => !/^\d+$/.test(m[1]!)) ? "NAMED" : "POSITIONAL";
}

/** null si cuadran; si no, el mensaje de error de Meta (código 132000). */
export function checkTemplateBodyParams(templateBody: string, sent: unknown[] | undefined): string | null {
  const params = (sent ?? []) as SentParameter[];
  if (mockParameterFormat(templateBody) === "NAMED") {
    const expected = [...new Set([...templateBody.matchAll(ANY_VARIABLE)].map((m) => m[1]!))];
    const names = params.map((p) => p.parameter_name);
    if (names.some((n) => !n)) {
      return "(#132000) Number of parameters does not match the expected number of params: the template uses named parameters and parameter_name is missing";
    }
    const same = names.length === expected.length && expected.every((n) => names.includes(n));
    if (!same) {
      return `(#132000) Number of parameters does not match the expected number of params: expected ${expected.join(", ")}, got ${names.join(", ")}`;
    }
    return null;
  }
  const expected = [...templateBody.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].reduce((max, m) => Math.max(max, Number(m[1])), 0);
  if (params.some((p) => p.parameter_name)) {
    return "(#132000) Number of parameters does not match the expected number of params: the template uses positional parameters";
  }
  if (params.length !== expected) {
    return `(#132000) Number of parameters does not match the expected number of params: expected ${expected}, got ${params.length}`;
  }
  return null;
}
