/**
 * Asistente interno — las ACCIONES (reglas puras). El asistente hace lo que la
 * persona haría en el CRM, con las mismas herramientas del conector de IA
 * (`src/server/ai-connector/`), pero solo las de esta lista CERRADA:
 *
 * - LEER (corren al momento, como una consulta más): chats, etapas, etiquetas,
 *   tareas, notas de trabajo, la ficha de un contacto, resultados…
 * - CAMBIAR (el asistente solo las PROPONE; corren cuando la persona pulsa
 *   «Aplicar»): mover de etapa, etiquetar, notas, tareas, asignar, ficha…
 *
 * Fuera de la lista, a propósito: enviar mensajes, plantillas y material,
 * campañas, importar/exportar, agentes, ajustes y todo lo que el conector
 * trata como «función avanzada». Agregar una a esta lista pide revisar que no
 * mande nada al cliente (`tests/unit/assistant-gate.test.ts`).
 */

export const ASSISTANT_READ_TOOLS = [
  "list_chats",
  "read_chat",
  "read_contact",
  "list_stages",
  "list_pipeline",
  "list_tags",
  "list_tasks",
  "list_work_notes",
  "list_people",
  "list_quick_replies",
  "get_results",
] as const;

export const ASSISTANT_WRITE_TOOLS = [
  "move_stage",
  "update_lead",
  "tag_chat",
  "add_note",
  "create_task",
  "update_task",
  "create_work_note",
  "update_work_note",
  "update_contact",
  "assign_chat",
  "update_chat",
  "open_chat",
] as const;

/** Acciones que puede proponer una sola respuesta. */
export const MAX_PROPOSALS = 20;

export function isAssistantReadTool(name: string): boolean {
  return (ASSISTANT_READ_TOOLS as readonly string[]).includes(name);
}

export function isAssistantWriteTool(name: string): boolean {
  return (ASSISTANT_WRITE_TOOLS as readonly string[]).includes(name);
}

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
