export type AssistantTurn = Readonly<{
  id: string;
  question: string;
  answer: string;
  tagTargets?: readonly string[];
  dismissed?: boolean;
  context?: Readonly<{ runId: string; evaluationId: string }>;
}>;
export type AssistantThread = Readonly<{
  id: string;
  title: string;
  at: number;
  archived: boolean;
  turns: readonly AssistantTurn[];
}>;
export type AssistantData = Readonly<{
  mode: "fast" | "normal" | "deep";
  activeId: string;
  threads: readonly AssistantThread[];
}>;
export const emptyAssistant: AssistantData = Object.freeze({
  mode: "normal",
  activeId: "demo-assistant-general",
  threads: Object.freeze([
    Object.freeze({
      id: "demo-assistant-general",
      title: "Chat general",
      at: 0,
      archived: false,
      turns: Object.freeze([]),
    }),
    Object.freeze({
      id: "demo-assistant-audit",
      title: "Auditoría de agentes",
      at: Date.parse("2026-11-17T10:00:00-05:00"),
      archived: false,
      turns: Object.freeze([]),
    }),
    Object.freeze({
      id: "demo-assistant-december",
      title: "Campaña de diciembre",
      at: Date.parse("2026-11-17T10:00:00-05:00"),
      archived: false,
      turns: Object.freeze([]),
    }),
  ]),
});
export function freezeAssistant(d: AssistantData): AssistantData {
  return Object.freeze({
    ...d,
    threads: Object.freeze(
      d.threads.map((t) =>
        Object.freeze({
          ...t,
          turns: Object.freeze(
            t.turns.map((v) =>
              Object.freeze({
                ...v,
                tagTargets: v.tagTargets
                  ? Object.freeze([...v.tagTargets])
                  : undefined,
                context: v.context
                  ? Object.freeze({ ...v.context })
                  : undefined,
              }),
            ),
          ),
        }),
      ),
    ),
  });
}
export function validateAssistant(d: AssistantData) {
  const text = (v: unknown, n: number) =>
    typeof v === "string" && v.length <= n;
  if (
    !d ||
    !["fast", "normal", "deep"].includes(d.mode) ||
    !text(d.activeId, 160) ||
    !Array.isArray(d.threads) ||
    d.threads.length > 20 ||
    !d.threads.some((t) => t.id === "demo-assistant-general" && !t.archived) ||
    !d.threads.some((t) => t.id === d.activeId && !t.archived) ||
    new Set(d.threads.map((t) => t.id)).size !== d.threads.length
  )
    throw Error("El asistente local no es válido.");
  for (const t of d.threads) {
    if (
      !t ||
      !/^demo-assistant-[\w-]{1,120}$/.test(t.id) ||
      !text(t.title, 120) ||
      !t.title.trim() ||
      !Number.isFinite(t.at) ||
      typeof t.archived !== "boolean" ||
      !Array.isArray(t.turns) ||
      t.turns.length > 40 ||
      new Set(t.turns.map((v: AssistantTurn) => v.id)).size !== t.turns.length
    )
      throw Error("El hilo del asistente no es válido.");
    for (const v of t.turns)
      if (
        !v ||
        !text(v.id, 160) ||
        !text(v.question, 2000) ||
        !v.question.trim() ||
        !text(v.answer, 6000) ||
        (v.dismissed !== undefined && typeof v.dismissed !== "boolean") ||
        (v.tagTargets !== undefined &&
          (!Array.isArray(v.tagTargets) ||
            v.tagTargets.length > 12 ||
            v.tagTargets.some(
              (id: unknown) =>
                typeof id !== "string" ||
                !/^demo-(conv|new)-[\w-]{1,100}$/.test(id),
            ))) ||
        (v.context !== undefined &&
          (!v.context ||
            !text(v.context.runId, 160) ||
            !text(v.context.evaluationId, 160)))
      )
        throw Error("Consulta local no válida.");
  }
}
