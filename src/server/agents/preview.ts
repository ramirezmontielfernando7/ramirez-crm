import { asc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { agendaEnabled } from "@/server/agenda/flag";
import { HANDOFF_BACKUP_ACK, matchesHandoffIntent } from "@/server/ai/handoff";
import { decideTurn, type TurnDecision } from "@/server/ai/pipeline";
import { toPromptConfig, type AgentConfig } from "./config";
import { retrieveForTurn } from "@/server/kb-docs/retrieve";
import { kbForConfig } from "./resolve";
import { AgentError, getAgent } from "./store";

/**
 * 031 — Vista previa del editor de agentes: «el dueño escribe como cliente y
 * responde el agente con lo que hay en el formulario», aunque no esté
 * guardado.
 *
 * SIN estado en el servidor (D3): el historial llega en cada petición. NO
 * EJECUTA NADA (D4): ni `message`, ni `lead`, ni `booking`, ni la agenda, ni
 * Meta. La única escritura es la cuota de IA (`ai_usage`, tipo `lab`) dentro
 * de `chatJsonForOrg`. Lo que el agente HARÍA se devuelve como chips.
 * Guardarraíl: `tests/unit/lab-preview-sandbox.test.ts`.
 */

export type PreviewChip = {
  kind: "note" | "move_stage" | "handoff" | "none" | "agenda" | "degraded";
  label: string;
};

export type PreviewResult =
  | {
      ok: true;
      reply: string | null;
      chips: PreviewChip[];
      /** El turno terminaría en una persona (en la vista previa se puede seguir escribiendo). */
      escalated: boolean;
      debug: {
        action: string;
        model: string | null;
        tokens: { prompt: number; completion: number } | null;
        ms: number;
        kbEntryIds: string[];
        /** 035 — Fragmentos de documentos que el agente tuvo a la vista. */
        docChunkIds: string[];
      };
    }
  | { ok: false; error: "quota_exceeded" | "not_configured" };

export type PreviewInput = {
  organizationId: string;
  agentId: string;
  config: AgentConfig;
  history: { role: "user" | "assistant"; text: string }[];
  message: string;
};

const AGENDA_NOTE = "(en producción usa tu agenda real)";

export async function runPreview(input: PreviewInput): Promise<PreviewResult> {
  const agent = await getAgent(input.organizationId, input.agentId);
  if (!agent) throw new AgentError("not_found", "Agente no encontrado");

  // El patrón de respaldo corre ANTES del modelo, como en producción: el
  // acuse fijo y el traspaso, sin gastar IA.
  if (matchesHandoffIntent(input.message)) {
    return {
      ok: true,
      reply: HANDOFF_BACKUP_ACK,
      chips: [{ kind: "handoff", label: "Escalaría a humano (el cliente pidió una persona)" }],
      escalated: true,
      debug: { action: "handoff", model: null, tokens: null, ms: 0, kbEntryIds: [], docChunkIds: [] },
    };
  }

  const kb = await kbForConfig(input.organizationId, agent, input.config);
  const stages = await getDb()
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, input.organizationId))
    .orderBy(asc(schema.pipelineStage.position));
  const agenda = await agendaEnabled(input.organizationId);
  const history = [
    ...input.history.map((m) => ({ role: m.role, content: m.text })),
    { role: "user" as const, content: input.message },
  ];
  // 035 — Igual que en producción: los documentos que vienen al caso.
  const docs = await retrieveForTurn(input.organizationId, history);

  const decision = await decideTurn({
    organizationId: input.organizationId,
    kind: "lab",
    config: toPromptConfig(input.config),
    kb,
    stages,
    agenda,
    history,
    tail: null,
    docs,
  });
  return toPreview(decision);
}

/** Traduce la decisión a burbuja + chips. Pura: nada se ejecuta. */
export function toPreview(decision: TurnDecision): PreviewResult {
  const debug = {
    model: decision.meta.model,
    tokens: decision.meta.tokens,
    ms: decision.meta.ms,
    kbEntryIds: decision.meta.kbEntryIds,
    docChunkIds: decision.meta.docChunkIds,
  };
  if (!decision.ok) {
    if (decision.error === "quota_exceeded" || decision.error === "not_configured") {
      return { ok: false, error: decision.error };
    }
    // En producción: traspaso con motivo `error`.
    return {
      ok: true,
      reply: null,
      chips: [{ kind: "handoff", label: "Escalaría a humano (la IA no dio una respuesta válida)" }],
      escalated: true,
      debug: { ...debug, action: "error" },
    };
  }
  const a = decision.action;
  const chips: PreviewChip[] = [];
  if (decision.degradedFrom === "move_stage") {
    chips.push({ kind: "degraded", label: "Quiso mover a una etapa que no existe (en producción no se mueve)" });
  } else if (decision.degradedFrom === "offer_slots" || decision.degradedFrom === "book_slot") {
    chips.push({ kind: "degraded", label: "Quiso usar la agenda, que no está encendida" });
  }
  switch (a.action) {
    case "reply":
      return { ok: true, reply: a.text, chips, escalated: false, debug: { ...debug, action: a.action } };
    case "none":
      chips.push({ kind: "none", label: "No respondería" });
      return { ok: true, reply: null, chips, escalated: false, debug: { ...debug, action: a.action } };
    case "update_lead":
      chips.push({ kind: "note", label: `Anotaría: ${a.note}` });
      return { ok: true, reply: a.reply ?? null, chips, escalated: false, debug: { ...debug, action: a.action } };
    case "move_stage":
      chips.push({ kind: "move_stage", label: `Movería a ${decision.stage?.name ?? a.stage}` });
      return { ok: true, reply: a.reply ?? null, chips, escalated: false, debug: { ...debug, action: a.action } };
    case "handoff":
      chips.push({ kind: "handoff", label: "Escalaría a humano" });
      return { ok: true, reply: a.farewell ?? null, chips, escalated: true, debug: { ...debug, action: a.action } };
    case "offer_slots":
      chips.push({ kind: "agenda", label: `Ofrecería horarios ${AGENDA_NOTE}` });
      return { ok: true, reply: a.reply ?? null, chips, escalated: false, debug: { ...debug, action: a.action } };
    case "book_slot":
      chips.push({ kind: "agenda", label: `Reservaría un horario ${AGENDA_NOTE}` });
      return { ok: true, reply: a.reply ?? null, chips, escalated: false, debug: { ...debug, action: a.action } };
  }
}
