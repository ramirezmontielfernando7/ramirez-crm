import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 031 (D4) — La vista previa del editor de agentes NO EJECUTA NADA: ni una
 * escritura en la BD, ni WhatsApp (Graph / `sendText`), ni la agenda
 * (`offerSlots` / `bookSlot`), aunque el modelo pida cada acción posible. Lo
 * único que se toca es la cuota, dentro de `chatJsonForOrg` (aquí simulado).
 * Complementa la prueba con BD real de `tests/db/agentes.test.ts`, que cuenta
 * filas antes y después.
 */

const h = vi.hoisted(() => ({
  writes: [] as string[],
  action: { action: "reply", text: "hola" } as Record<string, unknown>,
}));

const graphRequest = vi.fn();
const sendText = vi.fn();
const offerSlots = vi.fn();
const bookSlot = vi.fn();
const chatJsonForOrg = vi.fn();

vi.mock("@/lib/meta/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meta/client")>()),
  graphRequest,
}));
vi.mock("@/server/inbox/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/inbox/send")>()),
  sendText,
}));
vi.mock("@/server/agenda/agent", () => ({ offerSlots, bookSlot }));
vi.mock("@/server/agenda/flag", () => ({ agendaEnabled: async () => true }));
vi.mock("@/server/ai-quota/llm", () => ({ chatJsonForOrg }));
vi.mock("@/server/agents/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/agents/store")>()),
  getAgent: async () => ({ id: "agt_1", isGeneral: false }),
}));
vi.mock("@/server/agents/resolve", () => ({
  kbForConfig: async () => [{ id: "kb_1", kind: "qa", question: "¿Qué venden?", answer: "Clavos", content: null }],
}));

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "leftJoin", "innerJoin"]) c[m] = () => c;
  (c as { then: unknown }).then = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
  return c;
}

vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  const prohibido = (op: string) => () => {
    h.writes.push(op);
    throw new Error(`la vista previa intentó ${op}`);
  };
  return {
    ...real,
    getDb: () => ({
      select: () => chain([{ id: "stg_1", name: "Interesado" }]),
      insert: prohibido("insert"),
      update: prohibido("update"),
      delete: prohibido("delete"),
      transaction: prohibido("transaction"),
      execute: prohibido("execute"),
    }),
    withTenant: prohibido("withTenant"),
  };
});

const { runPreview } = await import("@/server/agents/preview");

const config = {
  v: 1 as const,
  displayName: null,
  tone: null,
  greeting: null,
  instructions: null,
  escalationRules: null,
  useSharedKb: true,
};

async function turno(action: Record<string, unknown>) {
  chatJsonForOrg.mockResolvedValueOnce({ ok: true, data: action, raw: "", usage: { promptTokens: 1, completionTokens: 1 } });
  return runPreview({ organizationId: "org_1", agentId: "agt_1", config, history: [], message: "hola" });
}

beforeEach(() => {
  h.writes.length = 0;
  for (const f of [graphRequest, sendText, offerSlots, bookSlot, chatJsonForOrg]) f.mockReset();
});

describe("vista previa: sandbox inviolable", () => {
  it.each([
    [{ action: "reply", text: "hola" }, null],
    [{ action: "none" }, "none"],
    [{ action: "update_lead", note: "quiere 3", reply: "anotado" }, "note"],
    [{ action: "move_stage", stage: "Interesado", reply: "va" }, "move_stage"],
    [{ action: "move_stage", stage: "No existe", reply: "va" }, "degraded"],
    [{ action: "handoff", farewell: "te paso" }, "handoff"],
    [{ action: "offer_slots", reply: "mira" }, "agenda"],
    [{ action: "book_slot", startUtc: "2026-01-01T15:00:00.000Z", reply: "listo" }, "agenda"],
  ])("%o → chip %s, sin escribir ni enviar nada", async (action, chip) => {
    const r = await turno(action);
    expect(r.ok).toBe(true);
    if (r.ok && chip) expect(r.chips.map((c) => c.kind)).toContain(chip);
    expect(h.writes).toEqual([]);
    expect(graphRequest).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(offerSlots).not.toHaveBeenCalled();
    expect(bookSlot).not.toHaveBeenCalled();
    expect(chatJsonForOrg).toHaveBeenCalledWith("org_1", "lab", expect.anything(), expect.anything());
  });

  it("el modelo recibe el historial del cliente y el mensaje nuevo, al final", async () => {
    chatJsonForOrg.mockResolvedValueOnce({ ok: true, data: { action: "none" }, raw: "" });
    await runPreview({
      organizationId: "org_1",
      agentId: "agt_1",
      config,
      history: [
        { role: "user", text: "hola" },
        { role: "assistant", text: "¿en qué te ayudo?" },
      ],
      message: "¿qué venden?",
    });
    const messages = chatJsonForOrg.mock.calls[0]![3] as { role: string; content: string }[];
    expect(messages.slice(1)).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "¿en qué te ayudo?" },
      { role: "user", content: "¿qué venden?" },
    ]);
    expect(messages[0]!.content).toContain("P: ¿Qué venden?\nR: Clavos");
  });
});
