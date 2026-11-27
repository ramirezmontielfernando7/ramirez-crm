import type { AssistantMessageMeta, AssistantProposal } from "@/lib/assistant-engine";
import type { SessionContext } from "@/lib/auth/session";
import { logger } from "@/lib/log";
import { assistantContext, assistantTools } from "./tools";
import { getAnswerMeta, saveAnswerMeta } from "./threads";

/**
 * Asistente — aplicar (o descartar) lo que PROPUSO. Cada acción pendiente de
 * una respuesta corre con la herramienta del conector, con la sesión de quien
 * pulsa «Aplicar»: los permisos de hoy (no los de cuando se propuso) y la
 * misma puerta del CRM de siempre. Una acción que ya no se puede (el chat ya
 * no es suyo, perdió el permiso) queda «falló» con el motivo; las demás siguen.
 */

const log = logger("asistente");

/** Una respuesta a la vez: dos clics seguidos no aplican dos veces. */
const enCurso = new Set<string>();

type ApplyOutcome =
  | { ok: true; proposals: AssistantProposal[] }
  | { ok: false; status: number; code: string; message: string };

export async function resolveProposals(input: {
  session: SessionContext;
  threadId: string;
  messageId: string;
  action: "apply" | "cancel";
  /** Solo estas (las pendientes); sin lista, todas las pendientes. */
  ids?: string[];
}): Promise<ApplyOutcome> {
  const { session } = input;
  const key = `${session.organizationId}:${input.messageId}`;
  if (enCurso.has(key)) return { ok: false, status: 429, code: "assistant_busy", message: "Ya se están aplicando estos cambios." };
  enCurso.add(key);
  try {
    const meta = await getAnswerMeta(session.organizationId, session.userId, input.threadId, input.messageId);
    if (!meta?.proposals?.length) return { ok: false, status: 404, code: "not_found", message: "No hay cambios pendientes en esa respuesta." };
    const chosen = (p: AssistantProposal) => p.status === "pending" && (!input.ids || input.ids.includes(p.id));
    if (!meta.proposals.some(chosen)) return { ok: false, status: 409, code: "nothing_pending", message: "Esos cambios ya se aplicaron o se descartaron." };

    const tools = input.action === "apply" ? await assistantTools(session) : null;
    for (const p of meta.proposals) {
      if (!chosen(p)) continue;
      if (input.action === "cancel") {
        p.status = "cancelled";
        continue;
      }
      const tool = tools?.write.find((t) => t.name === p.tool);
      if (!tool) {
        p.status = "failed";
        p.result = "Ya no tienes permiso para este cambio.";
        continue;
      }
      try {
        const parsed = tool.parse.safeParse(p.args);
        if (!parsed.success) {
          p.status = "failed";
          p.result = "Los datos del cambio ya no son válidos.";
          continue;
        }
        const out = await tool.run(assistantContext(session), parsed.data);
        if (out.isError) {
          p.status = "failed";
          p.result = String((out.data as { error?: unknown }).error ?? out.summary ?? "No se pudo aplicar.").slice(0, 200);
        } else {
          p.status = "applied";
          p.result = out.summary.slice(0, 200);
        }
      } catch (err) {
        log.error("falló un cambio propuesto por el asistente", { org: session.organizationId, tool: p.tool, err });
        p.status = "failed";
        p.result = "No se pudo aplicar por un error interno.";
      }
    }
    const next: AssistantMessageMeta = { ...meta, proposals: meta.proposals };
    await saveAnswerMeta(session.organizationId, input.threadId, input.messageId, next);
    return { ok: true, proposals: meta.proposals };
  } finally {
    enCurso.delete(key);
  }
}
