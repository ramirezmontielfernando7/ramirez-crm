export type AgentConfig = Readonly<{
  displayName: string;
  speakAsTeam: boolean;
  instructions: string;
  tone: string;
  handoff: string;
  greeting: string;
  sharedKnowledge: boolean;
}>;
export type AgentVersion = Readonly<{
  number: number;
  at: number;
  summary: string;
  config: AgentConfig;
}>;
export type Agent = Readonly<{
  id: string;
  name: string;
  general: boolean;
  paused: boolean;
  archived: boolean;
  revision: number;
  draft: AgentConfig;
  versions: readonly AgentVersion[];
}>;
export type CreatorTurn = Readonly<{
  id: string;
  text: string;
  answer: string;
}>;
export type Evaluation = Readonly<{
  id: string;
  name: string;
  grade: "ok" | "review" | "failed";
  summary: string;
  question: string;
  answer: string;
  decision: "reply" | "handoff";
  proposed: boolean;
  repeat: number;
}>;
export type EvaluationRun = Readonly<{
  id: string;
  agentId: string;
  agentName: string;
  revision: number;
  source: "draft" | "published";
  version: number | null;
  config: AgentConfig;
  count: 3 | 5 | 8;
  at: number;
  results: readonly Evaluation[];
}>;
export type StudioDoc = Readonly<{
  schema: 1;
  revision: number;
  sequence: number;
  globalPaused: boolean;
  agents: readonly Agent[];
  assignments: Readonly<Record<string, string>>;
  creator: Readonly<{ turns: readonly CreatorTurn[]; agentId: string | null }>;
  runs: readonly EvaluationRun[];
  receipts: readonly Readonly<{
    key: string;
    signature: string;
    result?: string;
  }>[];
}>;
export const agentCatalog = Object.freeze([
  Object.freeze({ id: "demo-agent-a1", name: "Ventas — general" }),
  Object.freeze({ id: "demo-agent-a2", name: "Citas y agenda" }),
]);
export const baseAgentConfig: AgentConfig = Object.freeze({
  displayName: "Sofi",
  speakAsTeam: false,
  instructions:
    "Eres la asistente de ventas de una joyería. Responde breve, con calidez. Ofrece el catálogo y agenda visitas.",
  tone: "Cercano y directo",
  handoff: "Si piden descuentos, facturas o están molestos.",
  greeting: "¡Hola! Soy Sofi 👋 ¿En qué te ayudo?",
  sharedKnowledge: true,
});
export function freezeStudio(d: StudioDoc): StudioDoc {
  return Object.freeze({
    ...d,
    agents: Object.freeze(
      d.agents.map((a) =>
        Object.isFrozen(a)
          ? a
          : Object.freeze({
              ...a,
              draft: Object.freeze({ ...a.draft }),
              versions: Object.freeze(
                a.versions.map((v) =>
                  Object.isFrozen(v) && Object.isFrozen(v.config)
                    ? v
                    : Object.freeze({
                        ...v,
                        config: Object.freeze({ ...v.config }),
                      }),
                ),
              ),
            }),
      ),
    ),
    assignments: Object.freeze({ ...d.assignments }),
    creator: Object.freeze({
      ...d.creator,
      turns: Object.freeze(d.creator.turns.map((t) => Object.freeze({ ...t }))),
    }),
    runs: Object.freeze(
      d.runs.map((r) =>
        Object.freeze({
          ...r,
          config: Object.freeze({ ...r.config }),
          results: Object.freeze(r.results.map((e) => Object.freeze({ ...e }))),
        }),
      ),
    ),
    receipts: Object.freeze(d.receipts.map((r) => Object.freeze({ ...r }))),
  });
}
export function seedStudio(): StudioDoc {
  const agents: Agent[] = [
    ...agentCatalog,
    { id: "demo-agent-a3", name: "Soporte posventa" },
  ].map((a, i) => ({
    ...a,
    general: i === 0,
    paused: false,
    archived: false,
    revision: 1,
    draft: {
      ...baseAgentConfig,
      speakAsTeam: i === 0,
      displayName: i === 0 ? "" : "Sofi",
      tone:
        i === 1
          ? "Amable, con usted"
          : i === 2
            ? "Paciente"
            : "Cercano y directo",
    },
    versions:
      i < 2
        ? [
            {
              number: 1,
              at: Date.parse("2026-11-01T10:00:00-05:00"),
              summary: "Primera versión",
              config: {
                ...baseAgentConfig,
                speakAsTeam: i === 0,
                displayName: i === 0 ? "" : "Sofi",
                tone: i === 1 ? "Amable, con usted" : "Cercano y directo",
              },
            },
          ]
        : [],
  }));
  return freezeStudio({
    schema: 1,
    revision: 0,
    sequence: 3,
    globalPaused: false,
    agents,
    assignments: {
      "demo-stage-1": "demo-agent-a2",
      "demo-stage-3": "demo-agent-a2",
    },
    creator: { turns: [], agentId: null },
    runs: [],
    receipts: [],
  });
}
export function validateConfig(c: AgentConfig) {
  if (
    !c ||
    typeof c !== "object" ||
    typeof c.displayName !== "string" ||
    c.displayName.length > 80 ||
    typeof c.speakAsTeam !== "boolean" ||
    typeof c.sharedKnowledge !== "boolean" ||
    typeof c.instructions !== "string" ||
    c.instructions.length > 12000 ||
    typeof c.tone !== "string" ||
    c.tone.length > 300 ||
    typeof c.handoff !== "string" ||
    c.handoff.length > 2000 ||
    typeof c.greeting !== "string" ||
    c.greeting.length > 2000
  )
    throw Error("La configuración del borrador no es válida.");
}
export function validateStudio(d: StudioDoc) {
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max;
  if (
    !d ||
    d.schema !== 1 ||
    !Number.isSafeInteger(d.revision) ||
    d.revision < 0 ||
    !Number.isSafeInteger(d.sequence) ||
    d.sequence < 3 ||
    typeof d.globalPaused !== "boolean" ||
    !Array.isArray(d.agents) ||
    d.agents.length > 100 ||
    !d.assignments ||
    typeof d.assignments !== "object" ||
    Array.isArray(d.assignments) ||
    Object.keys(d.assignments).length > 100 ||
    !d.creator ||
    !Array.isArray(d.creator.turns) ||
    d.creator.turns.length > 40 ||
    !Array.isArray(d.runs) ||
    d.runs.length > 20 ||
    !Array.isArray(d.receipts) ||
    d.receipts.length > 300
  )
    throw Error("El documento local de Estudio no es válido.");
  for (const a of d.agents) {
    if (
      !a ||
      !/^demo-agent-(a[123]|local-\d+)$/.test(a.id) ||
      !text(a.name, 120) ||
      !a.name.trim() ||
      typeof a.general !== "boolean" ||
      typeof a.paused !== "boolean" ||
      typeof a.archived !== "boolean" ||
      !Number.isSafeInteger(a.revision) ||
      a.revision < 1 ||
      !Array.isArray(a.versions) ||
      a.versions.length > 50 ||
      (a.archived && a.general)
    )
      throw Error("El agente local no es válido.");
    validateConfig(a.draft);
    let previous = 0;
    for (const v of a.versions) {
      if (
        !v ||
        !Number.isSafeInteger(v.number) ||
        v.number <= previous ||
        !Number.isFinite(v.at) ||
        !text(v.summary, 200)
      )
        throw Error("La versión local no es válida.");
      previous = v.number;
      validateConfig(v.config);
    }
    if (a.general && !a.versions.length)
      throw Error("El agente general debe tener una versión publicada.");
    const n = /local-(\d+)$/.exec(a.id);
    if (n && +n[1]! > d.sequence) throw Error("Secuencia de agentes inválida.");
  }
  if (
    new Set(d.agents.map((a) => a.id)).size !== d.agents.length ||
    d.agents.filter((a) => a.general && !a.archived).length !== 1
  )
    throw Error("Debe existir un solo agente general activo.");
  for (const [key, id] of Object.entries(d.assignments)) {
    const a = d.agents.find((a) => a.id === id);
    if (
      !/^demo-stage-(\d+|local-[a-z0-9-]{8,80})$/.test(key) ||
      !a ||
      a.general ||
      a.archived ||
      !a.versions.length
    )
      throw Error("Asignación de agente local no válida.");
  }
  if (
    d.creator.agentId !== null &&
    !d.agents.some((a) => a.id === d.creator.agentId)
  )
    throw Error("El creador apunta a un borrador no disponible.");
  for (const t of d.creator.turns)
    if (!t || !text(t.id, 160) || !text(t.text, 2000) || !text(t.answer, 3000))
      throw Error("La conversación del creador no es válida.");
  for (const r of d.runs) {
    if (
      !r ||
      !/^demo-run-\d+$/.test(r.id) ||
      !d.agents.some((a) => a.id === r.agentId) ||
      !text(r.agentName, 120) ||
      !["draft", "published"].includes(r.source) ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1 ||
      (r.version !== null &&
        (!Number.isSafeInteger(r.version) || r.version < 1)) ||
      ![3, 5, 8].includes(r.count) ||
      !Number.isFinite(r.at) ||
      !Array.isArray(r.results) ||
      r.results.length !== r.count
    )
      throw Error("La prueba local no es válida.");
    validateConfig(r.config);
    for (const e of r.results)
      if (
        !e ||
        !text(e.id, 160) ||
        !text(e.name, 120) ||
        !["ok", "review", "failed"].includes(e.grade) ||
        !text(e.summary, 1000) ||
        !text(e.question, 2000) ||
        !text(e.answer, 4000) ||
        !["reply", "handoff"].includes(e.decision) ||
        typeof e.proposed !== "boolean" ||
        !Number.isSafeInteger(e.repeat) ||
        e.repeat < 0
      )
        throw Error("El resultado local no es válido.");
    if (
      new Set(r.results.map((e: Evaluation) => e.id)).size !== r.results.length
    )
      throw Error("Resultados de prueba duplicados.");
  }
  if (
    new Set(d.runs.map((r) => r.id)).size !== d.runs.length ||
    new Set(d.creator.turns.map((t) => t.id)).size !== d.creator.turns.length
  )
    throw Error("Identificadores de Estudio duplicados.");
  for (const r of d.receipts)
    if (
      !r ||
      !text(r.key, 160) ||
      !r.key ||
      !text(r.signature, 20000) ||
      (r.result !== undefined && !text(r.result, 160))
    )
      throw Error("Comprobante de Estudio no válido.");
  if (new Set(d.receipts.map((r) => r.key)).size !== d.receipts.length)
    throw Error("Operaciones duplicadas en Estudio.");
}
