import type { Masker } from "@/lib/assistant-engine";
import type { AssistantProposal } from "@/lib/assistant-engine";
import {
  argsHelp,
  ASSISTANT_CONNECTION_ID,
  ASSISTANT_SENDER_NAME,
  isExcludedTool,
  isSendingTool,
  MAX_PROPOSALS,
  SENDING_TEXT_MAX,
  shortDescription,
} from "@/lib/assistant-actions";
import type { SessionContext } from "@/lib/auth/session";
import { toolsFor, type ToolContext, type ToolSpec } from "@/server/ai-connector/tools";
import { getConversation } from "@/server/inbox/queries";

/**
 * El asistente usa las MISMAS herramientas del conector de IA (cada una por
 * la puerta de siempre del CRM, con la sesión y los permisos de la persona),
 * pero solo las de la lista cerrada de `src/lib/assistant-actions.ts`. Aquí:
 *
 * - qué herramientas tiene HOY esta persona (permisos y módulos incluidos);
 * - cómo se le describen al modelo;
 * - cómo se corre una de LECTURA (resultado enmascarado para el modelo);
 * - cómo se valida una PROPUESTA de cambio (no corre: espera el «Aplicar»).
 */

type AnyTool = ToolSpec<unknown>;

/**
 * El contexto con el que el asistente corre una herramienta del conector: la
 * sesión de la persona y una marca propia («Asistente») para la bitácora y la
 * burbuja de los mensajes que salgan por él.
 */
export function assistantContext(session: SessionContext): ToolContext {
  return { session, scopes: ["read", "write"], connectionId: ASSISTANT_CONNECTION_ID, assistantName: ASSISTANT_SENDER_NAME };
}

/**
 * Lo que la persona lee antes de pulsar «Aplicar» en un ENVÍO: a quién y qué
 * sale, calculado aquí (no lo escribe el modelo, que podría maquillarlo).
 */
export async function sendingLabel(session: SessionContext, tool: string, args: Record<string, unknown>): Promise<string | null> {
  if (!isSendingTool(tool)) return null;
  const cut = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").slice(0, n);
  if (tool === "launch_campaign") return `Lanzar la campaña ${cut(args.campaign_id, 60)} (sale a su público)`;
  const id = typeof args.conversation_id === "string" ? args.conversation_id : "";
  const found = id ? await getConversation(session.access, id) : null;
  const who = found ? (found.contact.name ?? found.contact.phone ?? "el chat") : "un chat de Mi número";
  // El mensaje COMPLETO (auditoría 2026-11, S-07): lo que no se ve no se puede aprobar.
  if (tool === "send_message") return `Enviar a ${who}: «${cut(args.text, SENDING_TEXT_MAX)}»`;
  if (tool === "send_template") {
    const vars = Array.isArray(args.variables) && args.variables.length ? ` (${args.variables.map((v) => cut(v, 40)).join(", ")})` : "";
    return `Enviar a ${who} la plantilla «${cut(args.template, 80)}»${vars}`;
  }
  return `Enviar a ${who} el material ${cut(args.material_id, 40)} (${cut(args.mode, 10) || "file"})`;
}

/** Herramientas de lectura y de cambio que esta persona puede usar ahora. */
export async function assistantTools(session: SessionContext): Promise<{ read: AnyTool[]; write: AnyTool[] }> {
  const all = (await toolsFor(session, ["read", "write"])) as AnyTool[];
  return {
    read: all.filter((t) => t.scope === "read" && !isExcludedTool(t.name)),
    write: all.filter((t) => t.scope === "write" && !isExcludedTool(t.name)),
  };
}

/** El texto del prompt: qué puede leer y qué puede proponer. */
export function renderToolCatalog(tools: { read: AnyTool[]; write: AnyTool[] }): string {
  const line = (t: AnyTool) => `- ${t.name} — ${shortDescription(t.description)} Parámetros: ${argsHelp(t.inputSchema)}.`;
  return [
    "HERRAMIENTAS PARA LEER EL CRM (se piden con {\"action\":\"query\"}, igual que el catálogo; corren al momento):",
    ...tools.read.map(line),
    "",
    "HERRAMIENTAS PARA CAMBIAR EL CRM (NUNCA corren solas: las PROPONES con {\"action\":\"propose\"} y la persona las aprueba con un botón):",
    ...tools.write.map(line),
  ].join("\n");
}

/** Cambia por fichas los nombres que aparecen en el resultado de una herramienta. */
function maskDeep(value: unknown, masker: Masker, key = ""): unknown {
  if (typeof value === "string") {
    if (key === "assignee" || key === "assignee_name") return masker.name("member", value) ?? value;
    return masker.text(value);
  }
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, masker, key));
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // Un contacto: su nombre se registra ANTES de recorrer el resto (para que el texto libre lo encuentre).
    if (key === "contact" && typeof obj.name === "string") masker.name("contact", obj.name);
    for (const [k, v] of Object.entries(obj)) {
      if (k === "name" && key === "contact" && typeof v === "string") out[k] = masker.name("contact", v) ?? v;
      else if ((k === "contact_name" || k === "contactName") && typeof v === "string") out[k] = masker.name("contact", v) ?? v;
      else out[k] = maskDeep(v, masker, k);
    }
    return out;
  }
  return value;
}

type ReadToolResult =
  | { ok: true; label: string; args: Record<string, unknown>; forModel: unknown; forOwner: unknown }
  | { ok: false; reason: string };

/** Corre UNA herramienta de lectura con la sesión de la persona. */
export async function runReadTool(
  session: SessionContext,
  tools: { read: AnyTool[] },
  masker: Masker,
  name: string,
  rawArgs: unknown
): Promise<ReadToolResult> {
  const tool = tools.read.find((t) => t.name === name);
  if (!tool) return { ok: false, reason: `la consulta «${name.slice(0, 60)}» no existe en el catálogo` };
  const parsed = tool.parse.safeParse(rawArgs ?? {});
  if (!parsed.success) return { ok: false, reason: `parámetros inválidos para ${tool.name}` };
  const out = await tool.run(assistantContext(session), parsed.data);
  if (out.isError) return { ok: false, reason: String((out.data as { error?: unknown }).error ?? "no se pudo") };
  return {
    ok: true,
    label: tool.title,
    args: (parsed.data ?? {}) as Record<string, unknown>,
    forOwner: out.data,
    forModel: maskDeep(out.data, masker),
  };
}

function unmaskDeep(value: unknown, masker: Masker): unknown {
  if (typeof value === "string") return masker.unmask(value);
  if (Array.isArray(value)) return value.map((v) => unmaskDeep(v, masker));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, unmaskDeep(v, masker)]));
  }
  return value;
}

type ProposalCheck = { ok: true; proposal: AssistantProposal } | { ok: false; reason: string };

/** Revisa una propuesta del modelo: herramienta permitida y parámetros válidos. NO la corre. */
export function checkProposal(
  tools: { write: AnyTool[] },
  masker: Masker,
  index: number,
  change: { tool: string; args?: Record<string, unknown>; label: string }
): ProposalCheck {
  if (index >= MAX_PROPOSALS) return { ok: false, reason: `ya son ${MAX_PROPOSALS} cambios: el tope por respuesta` };
  const tool = tools.write.find((t) => t.name === change.tool);
  if (!tool) return { ok: false, reason: `el cambio «${change.tool.slice(0, 60)}» no existe o no te toca` };
  const args = unmaskDeep(change.args ?? {}, masker);
  const parsed = tool.parse.safeParse(args);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "argumentos"}: ${i.message}`).join("; ");
    return { ok: false, reason: `parámetros inválidos para ${tool.name} (${detail})`.slice(0, 300) };
  }
  return {
    ok: true,
    proposal: {
      id: `p${index + 1}`,
      tool: tool.name,
      label: masker.unmask(change.label).slice(0, 200),
      args: (parsed.data ?? {}) as Record<string, unknown>,
      status: "pending",
    },
  };
}
