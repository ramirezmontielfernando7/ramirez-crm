/**
 * Asistente interno — las ACCIONES (reglas puras). El asistente tiene las
 * MISMAS herramientas que el conector de IA (`src/server/ai-connector/`), con
 * los mismos permisos de la persona, los mismos módulos y las mismas
 * «funciones avanzadas» que el Propietario haya encendido para el conector:
 *
 * - LEER: corren al momento, como una consulta más.
 * - CAMBIAR y ENVIAR: el asistente solo las PROPONE; corren cuando la persona
 *   pulsa «Aplicar», con su sesión y por la misma puerta del CRM que la
 *   pantalla (ventana de 24 h, modo de conexión, tope diario compartido con el
 *   conector). Los envíos (`SENDING_TOOLS`) muestran el texto exacto.
 *
 * Fuera, a propósito: los enlaces de subida (abren otra pantalla). Como en el
 * conector, nada borra.
 */

/** Herramientas del conector que el asistente NO usa. */
export const ASSISTANT_EXCLUDED_TOOLS = ["create_upload_link", "check_upload_link"] as const;

/** Las que mandan algo a un cliente o a un público: la propuesta siempre dice qué y a quién. */
export const SENDING_TOOLS = ["send_message", "send_template", "send_material", "launch_campaign"] as const;

export function isSendingTool(name: string): boolean {
  return (SENDING_TOOLS as readonly string[]).includes(name);
}

export function isExcludedTool(name: string): boolean {
  return (ASSISTANT_EXCLUDED_TOOLS as readonly string[]).includes(name);
}

/** Cómo se marcan en la bitácora y en los mensajes los envíos del asistente (no es una conexión del conector). */
export const ASSISTANT_CONNECTION_ID = "assistant";
export const ASSISTANT_SENDER_NAME = "Asistente";

/** Primera frase de la descripción, corta, para no inflar el prompt con ~60 herramientas. */
export function shortDescription(description: string, max = 150): string {
  const flat = description.replace(/\s+/g, " ").trim();
  const first = flat.split(/(?<=[.!?])\s/)[0] ?? flat;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/** Acciones que puede proponer una sola respuesta. */
export const MAX_PROPOSALS = 20;

/** Una línea por parámetro («conversation_id* (texto)»), para el prompt. */
export function argsHelp(schema: Record<string, unknown>): string {
  const props = (schema.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const parts = Object.entries(props).map(([k, v]) => {
    const t = Array.isArray(v.enum) ? v.enum.map(String).join("|") : (v.type ?? "valor");
    return `${k}${required.has(k) ? "*" : ""}:${t}`;
  });
  return parts.length ? parts.join(", ") : "ninguno";
}
