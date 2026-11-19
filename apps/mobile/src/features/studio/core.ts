import {
  demoPlans,
  usageFixture,
  usageSummary,
  shouldUsagePrompt,
  type UsageScenario,
  type PlanId,
} from "./usage-model";
import { team } from "../contact/model";
import {
  emptyAssistant,
  type AssistantData,
  type AssistantTurn,
} from "./assistant-model";
import { ResultsStore } from "../results/core";
import type { LibraryStore, LibraryEntry } from "../library/core";
import type { ConversationRepository } from "../inbox/model";
import { normalize, stages } from "../inbox/model";
import {
  baseAgentConfig,
  freezeStudio,
  validateConfig,
  type StudioDoc,
  type Agent,
  type AgentConfig,
  type EvaluationRun,
  type Evaluation,
  type EvaluationAttempt,
} from "./model";
export type Decision = Readonly<{
  decision: "reply" | "handoff";
  answer: string;
  model: "Simulador local";
  tokens: number;
  knowledge: readonly string[];
}>;
export type DraftBuffer = Readonly<{
  base: number;
  config: AgentConfig;
  generation: number;
}>;
let keys = 0;
export const studioKey = () =>
  `demo-studio-${Date.now().toString(36)}-${++keys}`;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export class StudioStore {
  private queue: Promise<unknown> = Promise.resolve();
  private jobs = new Map<
    string,
    { signature: string; promise: Promise<string | null> }
  >();
  private buffers = new Map<string, DraftBuffer>();
  private flights = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  private state: Readonly<{ revision: number; error: string }> = Object.freeze({
    revision: 0,
    error: "",
  });
  constructor(
    readonly library: LibraryStore,
    readonly conversations: ConversationRepository,
    private now = Date.now,
  ) {
    library.subscribe(() => this.notify());
  }
  snapshot = () => this.state;
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  private notify(error = this.state.error) {
    this.state = Object.freeze({ revision: this.state.revision + 1, error });
    this.listeners.forEach((f) => {
      try {
        f();
      } catch {
        /* Observers cannot interrupt a commit. */
      }
    });
  }
  private allowed() {
    if (this.library.actor.role !== "owner")
      throw Error("Tu perfil no tiene acceso a Estudio IA.");
  }
  doc() {
    this.allowed();
    if (!this.library.snapshot().ready)
      throw Error("Espera a que se restaure Estudio.");
    return this.library.snapshot().studio;
  }
  list() {
    return this.doc().agents.filter((a) => !a.archived);
  }
  get(id: string) {
    const a = this.doc().agents.find((a) => a.id === id && !a.archived);
    if (!a) throw Error("Agente no disponible.");
    return a;
  }
  config(id: string) {
    const agent = this.get(id);
    return this.buffers.get(id)?.config ?? agent.draft;
  }
  dirty(id: string) {
    return this.buffers.has(id);
  }
  edit(id: string, patch: Partial<AgentConfig>) {
    const a = this.get(id),
      old = this.buffers.get(id),
      config = Object.freeze({ ...(old?.config ?? a.draft), ...patch });
    validateConfig(config);
    if (a.general && !config.sharedKnowledge)
      throw Error("El agente general siempre usa el conocimiento compartido.");
    if (same(config, a.draft)) {
      this.buffers.delete(id);
    } else
      this.buffers.set(
        id,
        Object.freeze({
          base: old?.base ?? a.revision,
          config,
          generation: (old?.generation ?? 0) + 1,
        }),
      );
    this.notify("");
  }
  discard(id: string) {
    this.allowed();
    this.buffers.delete(id);
    this.notify("");
  }
  flush(id: string): Promise<void> {
    const flight = this.flights.get(id);
    if (flight) return flight.then(() => this.flush(id));
    const b = this.buffers.get(id);
    if (!b) return Promise.resolve();
    const task = this.updateDraft(
      id,
      b.base,
      b.config,
      `draft-${id}-${b.base}-${b.generation}`,
    )
      .then(() => {
        const next = this.buffers.get(id),
          current = this.get(id);
        if (next === b) this.buffers.delete(id);
        else if (next)
          this.buffers.set(
            id,
            Object.freeze({ ...next, base: current.revision }),
          );
        this.notify("");
      })
      .finally(() => {
        this.flights.delete(id);
      });
    this.flights.set(id, task);
    return task;
  }
  private change(
    key: string,
    signature: unknown,
    fn: (d: StudioDoc) => {
      doc: StudioDoc;
      entries?: readonly LibraryEntry[];
      result?: string;
    },
  ): Promise<string | null> {
    this.allowed();
    if (!key || key.length > 160)
      throw Error("Identificador de operación no válido.");
    const sig = JSON.stringify(signature),
      job = this.jobs.get(key);
    if (job) {
      if (job.signature !== sig)
        throw Error("El identificador pertenece a otra operación.");
      return job.promise;
    }
    const promise = this.queue
      .catch(() => {})
      .then(async () => {
        const old = this.doc(),
          receipt = old.receipts.find((r) => r.key === key);
        if (receipt) {
          if (receipt.signature !== sig)
            throw Error("El identificador pertenece a otra operación.");
          return receipt.result ?? null;
        }
        const r = fn({
          ...old,
          revision: old.revision + 1,
          sequence: old.sequence + 1,
        });
        const next = freezeStudio({
          ...r.doc,
          receipts: [
            ...r.doc.receipts,
            { key, signature: sig, result: r.result },
          ].slice(-300),
        });
        await this.library.commitStudio(old.revision, next, r.entries);
        this.notify("");
        return r.result ?? null;
      })
      .catch((e) => {
        this.jobs.delete(key);
        this.notify(
          e instanceof Error ? e.message : "No se pudo guardar Estudio.",
        );
        throw e;
      });
    this.jobs.set(key, { signature: sig, promise });
    if (this.jobs.size > 300) this.jobs.delete(this.jobs.keys().next().value!);
    this.queue = promise;
    return promise;
  }
  private revise(a: Agent, expected: number) {
    if (a.revision !== expected)
      throw Error("El agente cambió. Vuelve a abrirlo antes de continuar.");
  }
  create(name = "Nuevo agente", key = studioKey()) {
    const title = name.trim();
    return this.change(key, ["create", title], (d) => {
      if (!title || title.length > 120 || d.agents.length >= 100)
        throw Error(
          "Elige un nombre de hasta 120 caracteres; máximo 100 agentes de demo.",
        );
      const id = `demo-agent-local-${d.sequence}`;
      return {
        doc: {
          ...d,
          agents: [
            ...d.agents,
            {
              id,
              name: title,
              general: false,
              paused: false,
              archived: false,
              revision: 1,
              draft: {
                ...baseAgentConfig,
                instructions: "",
                handoff: "",
                greeting: "",
              },
              versions: [],
            },
          ],
        },
        result: id,
      };
    });
  }
  updateDraft(
    id: string,
    revision: number,
    config: AgentConfig,
    key = studioKey(),
  ) {
    const copy = Object.freeze({ ...config });
    return this.change(key, ["draft", id, revision, copy], (d) => {
      const a = this.get(id);
      this.revise(a, revision);
      validateConfig(copy);
      if (a.general && !copy.sharedKnowledge)
        throw Error(
          "El agente general siempre usa el conocimiento compartido.",
        );
      return {
        doc: {
          ...d,
          agents: d.agents.map((x) =>
            x.id === id ? { ...a, revision: a.revision + 1, draft: copy } : x,
          ),
        },
      };
    });
  }
  rename(id: string, revision: number, name: string, key = studioKey()) {
    const value = name.trim();
    return this.change(key, ["name", id, revision, value], (d) => {
      const a = this.get(id);
      this.revise(a, revision);
      if (!value || value.length > 120)
        throw Error("Escribe un nombre interno de hasta 120 caracteres.");
      return {
        doc: {
          ...d,
          agents: d.agents.map((x) =>
            x.id === id ? { ...a, name: value, revision: a.revision + 1 } : x,
          ),
        },
      };
    });
  }
  async creator(text: string, key = studioKey()) {
    const value = text.trim();
    return this.change(key, ["creator", value], (d) => {
      if (!value || value.length > 2000)
        throw Error("Describe tu negocio con hasta 2000 caracteres.");
      let a = d.agents.find(
          (a) =>
            a.id === d.creator.agentId && !a.archived && !a.versions.length,
        ),
        config = a?.draft ?? baseAgentConfig;
      const q = normalize(value);
      config = {
        ...config,
        instructions: a
          ? config.instructions + `\nPedido de prueba: ${value}`
          : `Negocio descrito (simulación): ${value}\n${baseAgentConfig.instructions}`,
        tone: q.includes("formal") ? "Formal, con usted" : config.tone,
        handoff: q.includes("factura")
          ? `${config.handoff}\nPasar a una persona si piden factura.`
          : config.handoff,
      };
      validateConfig(config);
      const id = a?.id ?? `demo-agent-local-${d.sequence}`;
      if (!a && d.agents.length >= 100)
        throw Error("Se alcanzó el límite de agentes ficticios.");
      if (a && a.versions.length)
        throw Error(
          "El creador solo ajusta su borrador sin publicar. Crea uno nuevo.",
        );
      if (a && this.dirty(a.id))
        throw Error(
          "Guarda o descarta el borrador abierto antes de usar el creador.",
        );
      const agent: Agent = a
        ? { ...a, draft: config, revision: a.revision + 1 }
        : {
            id,
            name: "Joyería — ventas",
            general: false,
            paused: false,
            archived: false,
            revision: 1,
            draft: config,
            versions: [],
          };
      const answer =
        "Preparé un borrador local con tus instrucciones. Revísalo antes de publicarlo en la simulación.";
      return {
        doc: {
          ...d,
          agents: a
            ? d.agents.map((x) => (x.id === id ? agent : x))
            : [...d.agents, agent],
          creator: {
            agentId: id,
            turns: [
              ...d.creator.turns,
              { id: `demo-creator-${d.sequence}`, text: value, answer },
            ].slice(-40),
          },
        },
        result: id,
      };
    });
  }
  preview(id: string, text: string): Decision {
    const a = this.get(id);
    return this.evaluateConfig(a, this.config(id), text, false);
  }
  private evaluateConfig(
    a: Agent,
    config: AgentConfig,
    text: string,
    paused: boolean,
  ): Decision {
    const value = text.trim();
    if (!value || value.length > 2000)
      throw Error("Escribe un mensaje de prueba de hasta 2000 caracteres.");
    const q = normalize(value);
    const escalation =
      (/descuento|factura|molest|humano|persona|urgente/.test(q) &&
        !!config.handoff.trim()) ||
      (q.includes("cita") &&
        normalize(config.handoff).includes("disponibilidadconfirmada"));
    const decision = paused || escalation ? "handoff" : "reply";
    const knowledge = this.library
      .snapshot()
      .entries.filter((e) => {
        const info = this.library.knowledgeInfo(e);
        return (
          e.rag &&
          info.status === "indexed" &&
          (info.reader === a.id ||
            (info.reader === null && (a.general || config.sharedKnowledge)))
        );
      })
      .map((e) => e.title)
      .slice(0, 12);
    const answer =
      decision === "handoff"
        ? "Te paso con una persona del equipo para ayudarte."
        : q.includes("horario")
          ? "Nuestro horario de demostración es de lunes a viernes, de 9:00 a 19:00."
          : q.includes("30") || q.includes("descuento")
            ? "Claro, te doy el 30 % de descuento en tu primera compra."
            : `¡Hola! ${config.speakAsTeam ? "Somos el equipo." : config.displayName ? `Soy ${config.displayName}.` : "Te ayudamos."} ${knowledge.length ? "Tenemos un catálogo de demostración. ¿Buscas para ti o para regalo?" : "Cuéntame qué necesitas y revisaremos la información con el equipo."}`;
    return Object.freeze({
      decision,
      answer,
      model: "Simulador local",
      tokens: Math.ceil((value.length + answer.length) / 4),
      knowledge: Object.freeze(knowledge),
    });
  }
  publish(id: string, revision: number, key = studioKey()) {
    return this.change(key, ["publish", id, revision], (d) => {
      const a = this.get(id);
      this.revise(a, revision);
      if (this.dirty(id))
        throw Error("Espera a guardar el borrador antes de publicarlo.");
      if (!a.draft.instructions.trim() || !a.draft.handoff.trim())
        throw Error("Completa instrucciones y cuándo pasa a una persona.");
      if (a.versions.length >= 50)
        throw Error("Se alcanzó el límite de 50 versiones.");
      const last = a.versions.at(-1);
      if (last && same(last.config, a.draft))
        throw Error("No hay cambios nuevos para publicar.");
      return {
        doc: {
          ...d,
          agents: d.agents.map((x) =>
            x.id === id
              ? {
                  ...a,
                  revision: a.revision + 1,
                  versions: [
                    ...a.versions,
                    {
                      number: (last?.number ?? 0) + 1,
                      at: this.now(),
                      summary: last
                        ? "Actualizó el borrador"
                        : "Primera versión",
                      config: { ...a.draft },
                    },
                  ],
                }
              : x,
          ),
        },
      };
    });
  }
  loadVersion(id: string, revision: number, number: number, key = studioKey()) {
    let applied = false,
      initialBuffer: DraftBuffer | undefined,
      initialConfig: AgentConfig | undefined;
    return this.change(key, ["load", id, revision, number], (d) => {
      const a = this.get(id);
      this.revise(a, revision);
      const v = a.versions.find((v) => v.number === number);
      if (!v) throw Error("Versión no disponible.");
      initialBuffer = this.buffers.get(id);
      initialConfig = initialBuffer?.config ?? a.draft;
      applied = true;
      return {
        doc: {
          ...d,
          agents: d.agents.map((x) =>
            x.id === id
              ? {
                  ...a,
                  revision: a.revision + 1,
                  draft: {
                    ...v.config,
                    sharedKnowledge: a.general
                      ? true
                      : v.config.sharedKnowledge,
                  },
                }
              : x,
          ),
        },
      };
    }).then(() => {
      if (!applied) return;
      const current = this.buffers.get(id),
        a = this.get(id);
      if (current === initialBuffer) this.buffers.delete(id);
      else if (current && initialConfig) {
        const delta = Object.fromEntries(
          (Object.keys(current.config) as (keyof AgentConfig)[])
            .filter((k) => current.config[k] !== initialConfig![k])
            .map((k) => [k, current.config[k]]),
        );
        const config = Object.freeze({ ...a.draft, ...delta });
        if (same(config, a.draft)) this.buffers.delete(id);
        else
          this.buffers.set(
            id,
            Object.freeze({ ...current, config, base: a.revision }),
          );
      }
      this.notify("");
    });
  }
  pauseAll(paused: boolean, key = studioKey()) {
    return this.change(key, ["pause-all", paused], (d) => ({
      doc: { ...d, globalPaused: paused },
    }));
  }
  pause(id: string, revision: number, paused: boolean, key = studioKey()) {
    return this.change(key, ["pause", id, revision, paused], (d) => {
      const a = this.get(id);
      this.revise(a, revision);
      return {
        doc: {
          ...d,
          agents: d.agents.map((x) =>
            x.id === id ? { ...a, paused, revision: a.revision + 1 } : x,
          ),
        },
      };
    });
  }
  makeGeneral(id: string, revision: number, key = studioKey()) {
    return this.change(key, ["general", id, revision], (d) => {
      const a = this.get(id);
      this.revise(a, revision);
      if (!a.versions.length)
        throw Error("Publica una versión local antes de hacerlo general.");
      return {
        doc: {
          ...d,
          assignments: Object.fromEntries(
            Object.entries(d.assignments).filter(([, v]) => v !== id),
          ),
          agents: d.agents.map((x) =>
            x.id === id
              ? {
                  ...a,
                  general: true,
                  draft: { ...a.draft, sharedKnowledge: true },
                  revision: a.revision + 1,
                }
              : x.general
                ? { ...x, general: false, revision: x.revision + 1 }
                : x,
          ),
        },
      };
    });
  }
  archive(
    id: string,
    revision: number,
    policy: "general" | "delete",
    key = studioKey(),
  ) {
    return this.change(key, ["archive", id, revision, policy], (d) => {
      const a = this.get(id);
      this.revise(a, revision);
      if (a.general)
        throw Error("Elige otro agente general antes de archivar este.");
      if (!["general", "delete"].includes(policy))
        throw Error("Elige qué hacer con sus documentos.");
      const entries = this.library.snapshot().entries.flatMap((e) => {
        if (e.knowledge?.reader !== id) return [e];
        if (!e.rag)
          return [
            {
              ...e,
              version: e.version + 1,
              knowledge: { ...e.knowledge, reader: null },
            },
          ];
        if (policy === "general")
          return [
            {
              ...e,
              version: e.version + 1,
              knowledge: { ...e.knowledge, group: "General", reader: null },
            },
          ];
        return e.chat
          ? [
              {
                ...e,
                version: e.version + 1,
                rag: false,
                knowledge: { ...e.knowledge, reader: null },
              },
            ]
          : [];
      });
      return {
        doc: {
          ...d,
          agents: d.agents.map((x) =>
            x.id === id
              ? { ...a, archived: true, revision: a.revision + 1 }
              : x,
          ),
          assignments: Object.fromEntries(
            Object.entries(d.assignments).filter(([, v]) => v !== id),
          ),
        },
        entries,
      };
    }).then(() => {
      this.buffers.delete(id);
      this.notify("");
    });
  }
  usageData() {
    const previous = this.doc().usage,
      current = usageFixture(this.now());
    if (!previous) return current;
    if (previous.period === current.period) return previous;
    return {
      ...current,
      lastPromptAt: previous.lastPromptAt,
      snoozeUntil: previous.snoozeUntil,
      requests: previous.requests,
    };
  }
  usageStats() {
    const data = this.usageData(),
      summary = usageSummary(data, this.now()),
      entries = this.library.snapshot().entries;
    let bytes = 0;
    for (const e of entries) {
      if (e.file) bytes += e.file.bytes;
      else
        for (const ch of e.content) {
          const n = ch.codePointAt(0)!;
          bytes += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4;
        }
    }
    return {
      ...summary,
      data,
      agentUsage: ["demo-agent-a1", "demo-agent-a2"].map((id, i) => ({
        id,
        name:
          this.doc().agents.find((a) => a.id === id)?.name ??
          "Agente histórico",
        used:
          i === 0
            ? Math.round((data.used.agents * 10) / 13)
            : data.used.agents - Math.round((data.used.agents * 10) / 13),
      })),
      storageBytes: bytes,
      storageLimit: 5_000_000_000,
      people: team.length,
      peopleLimit: 5,
      documents: entries.filter((e) => e.rag).length,
      documentLimit: 100,
    };
  }
  usageScenario(scenario: UsageScenario, key = studioKey()) {
    return this.change(key, ["usage-scenario", scenario], (d) => {
      if (
        ![
          "normal",
          "warning",
          "assistant-blocked",
          "organization-blocked",
          "no-assistant-limit",
        ].includes(scenario)
      )
        throw Error("Escenario de demostración no válido.");
      return {
        doc: {
          ...d,
          usage: {
            ...usageFixture(this.now(), scenario),
            requests: this.usageData().requests,
          },
        },
      };
    });
  }
  requestPlan(plan: PlanId, key = studioKey()) {
    return this.change(key, ["plan-request", plan], (d) => {
      const data = this.usageData();
      if (!demoPlans.some((p) => p.id === plan))
        throw Error("Plan ficticio no disponible.");
      if (data.plan === plan)
        throw Error("Este ya es tu plan de demostración.");
      const existing = data.requests.find((r) => r.plan === plan);
      if (existing) return { doc: d, result: existing.id };
      if (data.requests.length >= 64)
        throw Error("Se alcanzó el límite de solicitudes de demostración.");
      const id = `demo-plan-request-${d.sequence}`;
      return {
        doc: {
          ...d,
          usage: {
            ...data,
            requests: [
              ...data.requests,
              { id, plan, at: this.now(), status: "pending-local" },
            ],
          },
        },
        result: id,
      };
    });
  }
  usageShouldPrompt() {
    return shouldUsagePrompt(this.usageData(), this.now());
  }
  usageClaimPrompt() {
    const now = this.now(),
      key = studioKey();
    return this.change(key, ["claim-usage-prompt"], (d) => {
      const data = this.usageData();
      if (!shouldUsagePrompt(data, now)) return { doc: d };
      return {
        doc: { ...d, usage: { ...data, lastPromptAt: now, snoozeUntil: 0 } },
        result: "show",
      };
    });
  }
  usageSnooze(key = studioKey()) {
    return this.change(key, ["snooze-usage"], (d) => ({
      doc: {
        ...d,
        usage: { ...this.usageData(), snoozeUntil: this.now() + 3 * 86400000 },
      },
    }));
  }
  assistantData() {
    return this.doc().assistant ?? emptyAssistant;
  }
  activeAssistant() {
    const d = this.assistantData();
    return (
      d.threads.find(
        (t) =>
          t.id === d.activeId &&
          !t.archived &&
          (t.id === "demo-assistant-general" ||
            this.now() - t.at <= 90 * 86400000),
      ) ?? d.threads.find((t) => t.id === "demo-assistant-general")!
    );
  }
  assistantThreads() {
    return this.assistantData().threads.filter(
      (t) =>
        !t.archived &&
        (t.id === "demo-assistant-general" ||
          this.now() - t.at <= 90 * 86400000),
    );
  }
  assistantMode(mode: AssistantData["mode"], key = studioKey()) {
    return this.change(key, ["mode", mode], (d) => {
      if (!["fast", "normal", "deep"].includes(mode))
        throw Error("Modo no válido.");
      return { doc: { ...d, assistant: { ...this.assistantData(), mode } } };
    });
  }
  assistantSelect(id: string, key = studioKey()) {
    return this.change(key, ["thread", id], (d) => {
      if (!this.assistantThreads().some((t) => t.id === id))
        throw Error("Hilo no disponible.");
      return {
        doc: { ...d, assistant: { ...this.assistantData(), activeId: id } },
      };
    });
  }
  assistantNew(title = "Hilo nuevo", key = studioKey()) {
    return this.change(key, ["new-thread", title], (d) => {
      const data = this.assistantData();
      if (data.threads.length >= 20)
        throw Error("Se alcanzó el límite de hilos de demostración.");
      const id = `demo-assistant-${d.sequence}`;
      return {
        doc: {
          ...d,
          assistant: {
            ...data,
            activeId: id,
            threads: [
              ...data.threads,
              {
                id,
                title: title.slice(0, 120) || "Hilo nuevo",
                at: this.now(),
                archived: false,
                turns: [],
              },
            ],
          },
        },
        result: id,
      };
    });
  }
  assistantArchive(id: string, key = studioKey()) {
    return this.change(key, ["archive-thread", id], (d) => {
      if (id === "demo-assistant-general")
        throw Error("El chat general es fijo.");
      if (!this.assistantThreads().some((t) => t.id === id))
        throw Error("Hilo no disponible.");
      const data = this.assistantData();
      return {
        doc: {
          ...d,
          assistant: {
            ...data,
            activeId:
              data.activeId === id ? "demo-assistant-general" : data.activeId,
            threads: data.threads.map((t) =>
              t.id === id ? { ...t, archived: true } : t,
            ),
          },
        },
      };
    });
  }
  assistantContext(runId: string, evaluationId: string, key = studioKey()) {
    return this.change(key, ["context", runId, evaluationId], (d) => {
      const run = this.runGet(runId),
        e = run.results.find((e) => e.id === evaluationId);
      if (!e) throw Error("Resultado no disponible.");
      const data = this.assistantData(),
        id = `demo-assistant-${d.sequence}`;
      if (data.threads.length >= 20)
        throw Error("Se alcanzó el límite de hilos de demostración.");
      const turn: AssistantTurn = {
        id: `demo-assistant-turn-${d.sequence}`,
        question: `Revisa la prueba: ${e.name}`,
        answer: `${e.summary} Agente: ${run.agentName}. Versión original: ${run.source === "published" ? `publicada v${run.version}` : "borrador"}. Este análisis es local y no modifica el agente.`,
        context: { runId, evaluationId },
      };
      return {
        doc: {
          ...d,
          assistant: {
            ...data,
            activeId: id,
            threads: [
              ...data.threads,
              {
                id,
                title: `Prueba · ${e.name}`.slice(0, 120),
                at: this.now(),
                archived: false,
                turns: [turn],
              },
            ],
          },
        },
        result: id,
      };
    });
  }
  assistantAsk(text: string, key = studioKey()) {
    const q = text.trim();
    return this.change(key, ["ask", q], (d) => {
      if (!q || q.length > 2000)
        throw Error("Escribe una consulta de hasta 2000 caracteres.");
      if (this.usageStats().assistantBlocked)
        throw Error("El asistente alcanzó su tope de demostración.");
      const data = this.assistantData(),
        thread = this.activeAssistant(),
        norm = normalize(q);
      const tagTargets = norm.includes("etiquet")
        ? this.conversations
            .list(this.library.actor)
            .filter(
              (c) => !c.archived && !c.group && c.search.includes("cotizacion"),
            )
            .slice(0, 12)
            .map((c) => c.id)
        : undefined;
      const context = thread.turns.findLast((t) => t.context)?.context;
      let contextAnswer = "";
      if (context) {
        try {
          const run = this.runGet(context.runId),
            e = run.results.find((e) => e.id === context.evaluationId);
          if (e)
            contextAnswer = `Sobre «${e.name}»: ${e.summary} La revisión original es ${run.revision}; se conserva la prueba y sus intentos. Los cambios se proponen en el borrador.`;
        } catch {
          contextAnswer =
            "Esta prueba ya salió del historial acotado; el hilo conserva su contexto original.";
        }
      }
      const summary = new ResultsStore(
        this.library.actor,
        this.now(),
      ).summary();
      const answer = tagTargets
        ? `Encontré ${tagTargets.length} chats ficticios que pidieron cotización. Propongo etiquetarlos como «Seguimiento». Solo se aplicará al pulsar Aplicar.`
        : norm.includes("vendi") || norm.includes("ventas")
          ? `Ventas de demostración del periodo: ${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(summary.money / 100)}; ${summary.won} tratos ganados. Datos ficticios de Resultados.`
          : norm.includes("chats")
            ? `El registro ficticio resume ${summary.ai} respuestas de IA y ${summary.handoffs} traspasos a una persona. No se consultó ningún servicio.`
            : contextAnswer ||
              `Revisé ${this.list().length} agentes ficticios: ${this.list().filter((a) => a.versions.length).length} con versión publicada y ${this.list().filter((a) => a.paused).length} en pausa. ${this.doc().globalPaused ? "La pausa global está activa." : "La pausa global está desactivada."} Para cambiar un agente se conserva primero su borrador.`;
      const turn: AssistantTurn = {
        id: `demo-assistant-turn-${d.sequence}`,
        question: q,
        answer,
        tagTargets,
      };
      return {
        doc: {
          ...d,
          assistant: {
            ...data,
            threads: data.threads.map((t) =>
              t.id === thread.id
                ? { ...t, turns: [...t.turns, turn].slice(-40) }
                : t,
            ),
          },
        },
      };
    });
  }
  assistantDismiss(turnId: string, key = studioKey()) {
    return this.change(key, ["dismiss", turnId], (d) => {
      const data = this.assistantData(),
        thread = this.activeAssistant();
      if (!thread.turns.some((t) => t.id === turnId && t.tagTargets))
        throw Error("Propuesta no disponible.");
      return {
        doc: {
          ...d,
          assistant: {
            ...data,
            threads: data.threads.map((t) =>
              t.id === thread.id
                ? {
                    ...t,
                    turns: t.turns.map((v) =>
                      v.id === turnId ? { ...v, dismissed: true } : v,
                    ),
                  }
                : t,
            ),
          },
        },
      };
    });
  }
  assistantApplyTags(turnId: string) {
    this.allowed();
    const turn = this.activeAssistant().turns.find((t) => t.id === turnId);
    if (turn?.dismissed) throw Error("La propuesta fue descartada.");
    if (!turn?.tagTargets?.length)
      throw Error("No hay propuesta de etiquetas para aplicar.");
    if (!this.conversations.tagMany)
      throw Error("El repositorio no ofrece cambios simulados en lote.");
    this.conversations.tagMany(
      this.library.actor,
      turn.tagTargets,
      "Seguimiento",
    );
    this.notify("");
  }
  assistantTagsApplied(turn: AssistantTurn) {
    return (
      !!turn.tagTargets?.length &&
      turn.tagTargets.every((id) => {
        try {
          return this.conversations
            .get(this.library.actor, id)
            .tags.includes("Seguimiento");
        } catch {
          return false;
        }
      })
    );
  }
  stageRows() {
    this.allowed();
    return (this.conversations.stageOptions?.() ?? stages).map((name) => {
      const index = stages.indexOf(name as (typeof stages)[number]);
      const id =
        this.conversations.stageIdentity?.(name) ??
        (index >= 0 ? `demo-stage-${index + 1}` : null);
      if (!id) throw Error("La etapa no tiene una identidad local estable.");
      return {
        name,
        id,
        color: this.conversations.stageColor?.(name) ?? "#94a3b8",
      };
    });
  }
  assign(
    stageId: string,
    id: string | null,
    previous: string | null,
    key = studioKey(),
  ) {
    return this.change(key, ["assign", stageId, id, previous], (d) => {
      if (!this.stageRows().some((s) => s.id === stageId))
        throw Error("La etapa ya no existe.");
      const current = d.assignments[stageId] ?? null;
      if (current !== previous)
        throw Error("La asignación cambió. Vuelve a elegir.");
      if (id) {
        const a = this.get(id);
        if (a.general || !a.versions.length)
          throw Error("Elige un agente publicado y no general.");
      }
      const stageIds = new Set(this.stageRows().map((s) => s.id));
      const assignments = Object.fromEntries(
        Object.entries(d.assignments).filter(([key]) => stageIds.has(key)),
      );
      if (id) assignments[stageId] = id;
      else delete assignments[stageId];
      return { doc: { ...d, assignments } };
    });
  }
  route(stage: string, text: string): Decision {
    const d = this.doc(),
      stageId = this.stageRows().find((s) => s.name === stage)?.id;
    const id = stageId ? d.assignments[stageId] : undefined;
    const a =
      d.agents.find((a) => a.id === id && !a.archived) ??
      d.agents.find((a) => a.general && !a.archived)!;
    return this.evaluateConfig(
      a,
      a.versions.at(-1)!.config,
      text,
      d.globalPaused || a.paused || this.usageStats().organizationBlocked,
    );
  }
  run(
    id: string,
    source: "draft" | "published",
    count: 3 | 5 | 8,
    key = studioKey(),
  ) {
    return this.change(key, ["run", id, source, count], (d) => {
      const a = this.get(id);
      if (
        ![3, 5, 8].includes(count) ||
        !["draft", "published"].includes(source)
      )
        throw Error("Elige 3, 5 u 8 clientes y una versión válida.");
      if (this.dirty(id)) throw Error("Guarda el borrador antes de probar.");
      const version = source === "published" ? a.versions.at(-1) : null;
      if (source === "published" && !version)
        throw Error("El agente aún no tiene versión publicada.");
      const config = version?.config ?? a.draft;
      if (!config.instructions.trim())
        throw Error("Completa las instrucciones del borrador.");
      const names = [
        "Pregunta por anillos",
        "Quiere una cita",
        "Pide descuento",
        "Necesita factura",
        "Busca catálogo",
        "Pregunta por horarios",
        "Pide una persona",
        "Compra para regalo",
      ];
      const questions = [
        "Hola, ¿tienen anillos de plata?",
        "¿Puedo agendar una cita?",
        "¿Me puedes dar un 30 % de descuento?",
        "Necesito mi factura",
        "¿Me compartes el catálogo?",
        "¿Cuál es el horario?",
        "Quiero hablar con una persona",
        "Busco un regalo",
      ];
      const results: Evaluation[] = Array.from({ length: count }, (_, i) => {
        const r = this.evaluateConfig(a, config, questions[i]!, false),
          grade =
            i === 2 && r.decision === "reply"
              ? "failed"
              : i === 1 && r.decision === "reply"
                ? "review"
                : "ok";
        return {
          id: `demo-eval-${d.sequence}-${i}`,
          name: names[i]!,
          question: questions[i]!,
          answer: r.answer,
          decision: r.decision,
          grade,
          summary:
            grade === "failed"
              ? "Prometió un descuento sin autorización."
              : grade === "review"
                ? "Revisa que confirme la disponibilidad de la cita."
                : "Respondió dentro de las reglas de demostración.",
          proposed: false,
          repeat: 0,
          attempts: [
            {
              revision: a.revision,
              source,
              version: version?.number ?? null,
              config: { ...config },
              at: this.now(),
              answer: r.answer,
              decision: r.decision,
              grade,
              knowledge: r.knowledge,
            },
          ],
        };
      });
      const run: EvaluationRun = {
        id: `demo-run-${d.sequence}`,
        agentId: id,
        agentName: a.name,
        revision: a.revision,
        source,
        version: version?.number ?? null,
        config: { ...config },
        count,
        at: this.now(),
        results,
      };
      return {
        doc: { ...d, runs: [run, ...d.runs].slice(0, 20) },
        result: run.id,
      };
    });
  }
  runGet(id: string) {
    const r = this.doc().runs.find((r) => r.id === id);
    if (!r) throw Error("Prueba no disponible.");
    return r;
  }
  proposeFix(
    runId: string,
    evaluationId: string,
    revision: number,
    key = studioKey(),
  ) {
    return this.change(key, ["fix", runId, evaluationId, revision], (d) => {
      const run = this.runGet(runId),
        e = run.results.find((e) => e.id === evaluationId);
      if (!e) throw Error("Resultado no disponible.");
      const a = this.get(run.agentId);
      this.revise(a, revision);
      if (e.grade === "ok") throw Error("Este resultado no necesita arreglo.");
      if (this.dirty(a.id))
        throw Error("Guarda primero los cambios del borrador.");
      const isAppointment = e.name === "Quiere una cita";
      const fix = isAppointment
        ? "No asegures una cita sin disponibilidad confirmada; pasa el chat a una persona."
        : "No prometas descuentos; si piden uno, pasa el chat a una persona.";
      const handoff = isAppointment
        ? "Si pide cita sin disponibilidad confirmada, pasar a una persona."
        : "Si piden descuentos, pasar a una persona.";
      return {
        doc: {
          ...d,
          agents: d.agents.map((x) =>
            x.id === a.id
              ? {
                  ...a,
                  revision: a.revision + 1,
                  draft: {
                    ...a.draft,
                    instructions: a.draft.instructions.includes(fix)
                      ? a.draft.instructions
                      : `${a.draft.instructions}\n${fix}`,
                    handoff: a.draft.handoff.includes(handoff)
                      ? a.draft.handoff
                      : `${a.draft.handoff}\n${handoff}`,
                  },
                }
              : x,
          ),
          runs: d.runs.map((r) =>
            r.id === runId
              ? {
                  ...r,
                  results: r.results.map((x) =>
                    x.id === evaluationId ? { ...x, proposed: true } : x,
                  ),
                }
              : r,
          ),
        },
      };
    });
  }
  repeat(runId: string, evaluationId: string, key = studioKey()) {
    return this.change(key, ["repeat", runId, evaluationId], (d) => {
      const run = this.runGet(runId),
        e = run.results.find((e) => e.id === evaluationId);
      if (!e) throw Error("Resultado no disponible.");
      const a = this.get(run.agentId);
      if (this.dirty(a.id))
        throw Error("Guarda el borrador antes de repetir la prueba.");
      const result = this.evaluateConfig(a, a.draft, e.question, false),
        grade =
          e.question.includes("descuento") && result.decision === "reply"
            ? "failed"
            : e.name === "Quiere una cita" && result.decision === "reply"
              ? "review"
              : "ok";
      const first: EvaluationAttempt = e.attempts?.[0] ?? {
        revision: run.revision,
        source: run.source,
        version: run.version,
        config: run.config,
        at: run.at,
        answer: e.answer,
        decision: e.decision,
        grade: e.grade,
        knowledge: [],
      };
      const attempt: EvaluationAttempt = {
        revision: a.revision,
        source: "draft",
        version: null,
        config: { ...a.draft },
        at: this.now(),
        answer: result.answer,
        decision: result.decision,
        grade,
        knowledge: result.knowledge,
      };
      const attempts = [
        first,
        ...(e.attempts?.slice(1) ?? []).slice(-3),
        attempt,
      ];
      return {
        doc: {
          ...d,
          runs: d.runs.map((r) =>
            r.id === runId
              ? {
                  ...r,
                  results: r.results.map((x) =>
                    x.id === evaluationId
                      ? {
                          ...x,
                          repeat: x.repeat + 1,
                          answer: result.answer,
                          decision: result.decision,
                          grade,
                          summary:
                            grade === "ok"
                              ? "Respondió dentro de las reglas de demostración."
                              : x.summary,
                          attempts,
                        }
                      : x,
                  ),
                }
              : r,
          ),
        },
      };
    });
  }
}
