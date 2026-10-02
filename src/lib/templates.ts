/**
 * Variables posicionales {{n}} del cuerpo de una plantilla de WhatsApp.
 * Puro y sin dependencias: lo usan tanto el servicio de servidor como la UI
 * (que necesita saber cuántos campos pintar antes de enviar).
 */

const VARIABLE_REGEX = /\{\{\s*(\d+)\s*\}\}/g;

/** Máximo de parámetros posicionales por cuerpo que acepta Meta. */
export const MAX_TEMPLATE_VARIABLES = 10;

/** Índices distintos de {{n}} presentes en el cuerpo, ordenados. */
function variableIndexes(body: string): number[] {
  const found = new Set<number>();
  for (const m of body.matchAll(VARIABLE_REGEX)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

/**
 * Cuántos parámetros exige el cuerpo = el índice más alto. Con la numeración
 * validada (1..N sin saltos) equivale al número de variables distintas.
 */
export function countVariables(body: string): number {
  const indexes = variableIndexes(body);
  return indexes.length ? indexes[indexes.length - 1]! : 0;
}

/**
 * Meta acepta varias variables por cuerpo, pero exige numeración posicional
 * contigua desde {{1}}: un salto ({{1}} y {{3}}) es rechazo seguro.
 */
export function validateBodyVariables(body: string): string | null {
  const indexes = variableIndexes(body);
  if (indexes.length === 0) return null;
  if (indexes.length > MAX_TEMPLATE_VARIABLES) {
    return `El cuerpo admite hasta ${MAX_TEMPLATE_VARIABLES} variables`;
  }
  for (let i = 0; i < indexes.length; i++) {
    if (indexes[i] !== i + 1) {
      return `Las variables deben ir numeradas {{1}}, {{2}}, … sin saltos (falta {{${i + 1}}})`;
    }
  }
  return null;
}

/** Sustituye {{n}} por `variables[n-1]` (vacío si no hay valor). */
export function renderBody(body: string, variables: string[] = []): string {
  return body.replace(VARIABLE_REGEX, (_match, index: string) => {
    return variables[Number(index) - 1] ?? "";
  });
}

/* ============================================================
 * Campañas v2 (PR 1) — Componentes completos de una plantilla
 * ============================================================ */

/** Un componente como lo guarda y devuelve Meta (subconjunto que se lee). */
export type TemplateComponentDto = {
  type: string;
  format?: string;
  text?: string;
  buttons?: { type: string; text?: string; url?: string; phone_number?: string }[];
  [key: string]: unknown;
};

export type TemplateButtonDraft =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string };

export type TemplateHeaderDraft = { format: "NONE" } | { format: "TEXT"; text: string } | { format: "IMAGE" };

/** Lo que se escribe en el CRM para crear una plantilla. */
export type TemplateDraft = {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  body: string;
  /** Un ejemplo por variable del cuerpo ({{1}} → bodyExamples[0]). Meta los pide para aprobar. */
  bodyExamples: string[];
  header: TemplateHeaderDraft;
  footer?: string | null;
  buttons: TemplateButtonDraft[];
};

/**
 * Valida el borrador ANTES de llamar a Meta. Solo reglas de forma que el
 * CRM necesita para poder ENVIAR después (ejemplos completos, sin variables
 * donde el envío no las sabe llenar); los topes de largo y cantidad los
 * decide Meta y su motivo de rechazo se muestra tal cual.
 */
export function validateTemplateDraft(d: TemplateDraft): string | null {
  const varError = validateBodyVariables(d.body);
  if (varError) return varError;
  const n = countVariables(d.body);
  const examples = d.bodyExamples.slice(0, n).map((e) => e.trim());
  if (examples.length < n || examples.some((e) => !e)) {
    return n === 1
      ? "Escribe un ejemplo para {{1}}: Meta lo pide para revisar la plantilla"
      : `Escribe un ejemplo para cada variable ({{1}} a {{${n}}}): Meta los pide para revisar la plantilla`;
  }
  if (d.header.format === "TEXT") {
    if (!d.header.text.trim()) return "Escribe el texto del encabezado o quítalo";
    if (/\{\{/.test(d.header.text)) return "El encabezado no admite variables en el CRM: deja el texto fijo";
  }
  if (d.footer && /\{\{/.test(d.footer)) return "El pie no admite variables";
  for (const b of d.buttons) {
    if (!b.text.trim()) return "Cada botón necesita su texto";
    if (b.type === "URL") {
      if (/\{\{/.test(b.url)) return "La URL del botón debe ser fija (sin variables)";
      if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(b.url.trim())) return `La URL «${b.url}» no es válida`;
    }
  }
  return null;
}

/** El borrador en el formato `components` de Meta. `headerHandle`: la imagen de ejemplo ya subida. */
export function buildTemplateComponents(d: TemplateDraft, headerHandle?: string | null): TemplateComponentDto[] {
  const out: TemplateComponentDto[] = [];
  if (d.header.format === "TEXT") out.push({ type: "HEADER", format: "TEXT", text: d.header.text.trim() });
  if (d.header.format === "IMAGE") {
    out.push({ type: "HEADER", format: "IMAGE", ...(headerHandle ? { example: { header_handle: [headerHandle] } } : {}) });
  }
  const n = countVariables(d.body);
  out.push({
    type: "BODY",
    text: d.body,
    ...(n > 0 ? { example: { body_text: [d.bodyExamples.slice(0, n).map((e) => e.trim())] } } : {}),
  });
  if (d.footer?.trim()) out.push({ type: "FOOTER", text: d.footer.trim() });
  if (d.buttons.length > 0) {
    out.push({
      type: "BUTTONS",
      buttons: d.buttons.map((b) =>
        b.type === "URL" ? { type: "URL", text: b.text.trim(), url: b.url.trim() } : { type: "QUICK_REPLY", text: b.text.trim() }
      ),
    });
  }
  return out;
}

/** El texto del cuerpo de una plantilla de Meta ("" si no tiene). */
export function bodyFromComponents(components: readonly TemplateComponentDto[] | null | undefined): string {
  return components?.find((c) => c.type?.toUpperCase() === "BODY")?.text ?? "";
}

export function headerOf(components: readonly TemplateComponentDto[] | null | undefined): TemplateComponentDto | null {
  return components?.find((c) => c.type?.toUpperCase() === "HEADER") ?? null;
}

/**
 * ¿Qué necesita el envío de esta plantilla además de las variables del
 * cuerpo? `unsupported` explica por qué el CRM todavía no puede mandarla
 * (en vez de dejar que Meta responda un 132000 críptico).
 */
export function sendRequirements(components: readonly TemplateComponentDto[] | null | undefined): {
  headerImage: boolean;
  unsupported: string | null;
} {
  const header = headerOf(components);
  const format = header?.format?.toUpperCase();
  let unsupported: string | null = null;
  if (format === "TEXT" && header?.text && /\{\{/.test(header.text)) {
    unsupported = "El encabezado tiene una variable; el CRM aún no sabe llenarla";
  } else if (format && !["TEXT", "IMAGE"].includes(format)) {
    unsupported = `El encabezado es de tipo ${format}; el CRM solo envía encabezados de texto o imagen`;
  }
  const buttons = components?.find((c) => c.type?.toUpperCase() === "BUTTONS")?.buttons ?? [];
  for (const b of buttons) {
    const t = b.type?.toUpperCase();
    if (t === "URL" && b.url && /\{\{/.test(b.url)) {
      unsupported ??= "Un botón tiene URL con variable; el CRM aún no sabe llenarla";
    } else if (t && !["QUICK_REPLY", "URL", "PHONE_NUMBER"].includes(t)) {
      unsupported ??= `Un botón es de tipo ${t}; el CRM aún no lo envía`;
    }
  }
  return { headerImage: format === "IMAGE", unsupported };
}
