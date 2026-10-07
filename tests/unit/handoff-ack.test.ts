import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HANDOFF_BACKUP_ACK } from "@/server/ai/handoff";

/**
 * FR-022 — Cuando el patrón de respaldo detecta que el cliente pide una
 * persona, el turno le AVISA antes de traspasar.
 *
 * Antes llamaba a `applyHandoff` y salía sin enviar nada: el traspaso ocurría
 * por dentro, pero del lado de WhatsApp quien había pedido un humano se
 * quedaba sin respuesta. El camino del modelo nunca tuvo ese hueco: se
 * despide con `farewell` y luego traspasa. Estas pruebas fijan que los dos
 * caminos salen por el MISMO emisor y en el mismo orden, y que el acuse
 * hereda sus garantías: sandbox, ventana y no repetirse.
 *
 * Lo encontró @fondeur27-09-73 en el PR #62, porque el Laboratorio marcaba en
 * rojo «pide un humano» con el escalado bien hecho: el juez solo ve mensajes,
 * y no había ninguno.
 */

/** Orden observable: qué se mandó y cuándo se traspasó. */
const eventos: string[] = [];

const sendText = vi.fn();
const graphRequest = vi.fn();
const chatJson = vi.fn();

vi.mock("@/server/inbox/send", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/inbox/send")>();
  return { ...original, sendText };
});

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

vi.mock("@/lib/ai", () => ({ chatJson }));

// BD simulada: cola de resultados de select + capturas de insert/update.
const selectQueue: unknown[][] = [];
const inserts: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        if (values.direction === "out") eventos.push(`persistido:${values.text}`);
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([values]),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve([values]).then(resolve),
        };
        return chain;
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        if (values.handoffReason) eventos.push(`handoff:${values.handoffReason}`);
        return {
          where: () => {
            const chain = {
              returning: () => Promise.resolve([{ id: "cv_1" }]),
              then: (resolve: (v: unknown) => void) =>
                Promise.resolve([{ id: "cv_1" }]).then(resolve),
            };
            return chain;
          },
        };
      },
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy(
          {},
          { get: (_t2, col) => `${String(tableName)}.${String(col)}` }
        ),
    }
  ),
}));

const HORA = 60 * 60 * 1000;

function conversacion(extra: Record<string, unknown> = {}) {
  return {
    id: "cv_1",
    organizationId: "org_1",
    contactId: "ct_1",
    channel: "whatsapp",
    isTest: false,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
    ...extra,
  };
}

const perfil = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Asistente",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
};

/** 031: el agente general publicado, leído junto con el perfil. */
const config = { v: 1, displayName: "Asistente", tone: null, greeting: null, instructions: null, escalationRules: null, useSharedKb: true };
const general = { id: "agt_1", organizationId: "org_1", isGeneral: true, publishedAt: null, draft: config, published: config };

function historial(text: string) {
  return [{ id: "msg_1", direction: "in", text, createdAt: new Date() }];
}

/** Un turno donde el cliente escribe `text`: conversación, perfil, historial. */
function turno(text: string, conv = conversacion()) {
  selectQueue.push([conv], [{ profile: perfil, agent: general }], historial(text));
}

/**
 * El pipeline arrastra medio servidor (envío, canales, agenda). Importarlo
 * dentro de la primera prueba se comía su timeout de 5 s en una corrida
 * cargada, y la prueba que expiraba seguía corriendo en segundo plano y se
 * comía la cola de selects de la siguiente. Se carga UNA vez, con margen.
 */
let runAgentTurn: (conversationId: string) => Promise<void>;
let SendError: typeof import("@/server/inbox/send").SendError;

async function correrTurno() {
  await runAgentTurn("cv_1");
}

describe("acuse del patrón de respaldo antes de traspasar (FR-022)", () => {
  beforeAll(async () => {
    ({ runAgentTurn } = await import("@/server/ai/pipeline"));
    ({ SendError } = await import("@/server/inbox/send"));
  }, 60_000);

  beforeEach(() => {
    eventos.length = 0;
    selectQueue.length = 0;
    inserts.length = 0;
    updates.length = 0;
    sendText.mockReset();
    sendText.mockImplementation(async (input: { text: string }) => {
      eventos.push(`enviado:${input.text}`);
      return { messageId: "msg_out" };
    });
    graphRequest.mockReset();
    chatJson.mockReset();
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  });

  it("el cliente que pide un humano recibe el acuse, y DESPUÉS se traspasa", async () => {
    turno("quiero hablar con un humano");
    await correrTurno();

    expect(eventos).toEqual([`enviado:${HANDOFF_BACKUP_ACK}`, "handoff:cliente"]);
    // Por el emisor de siempre: el mismo que usa el `farewell` del modelo,
    // con su guard de sandbox y de ventana dentro.
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith({
      conversationId: "cv_1",
      organizationId: "org_1",
      text: HANDOFF_BACKUP_ACK,
      aiGenerated: true,
    });
    // El respaldo sigue cortando ANTES del modelo.
    expect(chatJson).not.toHaveBeenCalled();
  });

  it("en el Laboratorio el acuse queda en la conversación y JAMÁS toca la API", async () => {
    turno("quiero hablar con un humano", conversacion({ isTest: true }));
    await correrTurno();

    expect(sendText).not.toHaveBeenCalled();
    expect(graphRequest).not.toHaveBeenCalled();
    const saliente = inserts.find((v) => v.direction === "out");
    expect(saliente).toMatchObject({
      text: HANDOFF_BACKUP_ACK,
      aiGenerated: true,
      origin: "ai",
    });
    // Y el juez del Laboratorio ya tiene qué leer antes del corte del guion.
    expect(eventos).toEqual([`persistido:${HANDOFF_BACKUP_ACK}`, "handoff:cliente"]);
  });

  it("si el acuse no sale, el traspaso se aplica IGUAL (y el turno no revienta)", async () => {
    sendText.mockRejectedValueOnce(
      new SendError("meta_unavailable", "Meta no está disponible ahora")
    );
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    turno("me pasas a un asesor");

    await expect(correrTurno()).resolves.toBeUndefined();

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(updates.some((u) => u.handoffReason === "cliente")).toBe(true);
    consola.mockRestore();
  });

  it("con la ventana de 24 h cerrada no hay texto libre: se traspasa por `ventana`", async () => {
    turno(
      "quiero hablar con un humano",
      conversacion({ lastInboundAt: new Date(Date.now() - 25 * HORA) })
    );
    await correrTurno();

    expect(sendText).not.toHaveBeenCalled();
    expect(eventos).toEqual(["handoff:ventana"]);
  });

  it("un turno que vuelve a correr tras el traspaso NO repite el acuse", async () => {
    // Primer turno: acuse + traspaso.
    turno("quiero hablar con un humano");
    await correrTurno();
    // Lo que llegue mientras tanto re-encola un turno; ese turno lee la
    // conversación YA traspasada. El último entrante sigue siendo la misma
    // frase, así que si el silencio no mandara, el acuse saldría dos veces.
    turno(
      "quiero hablar con un humano",
      conversacion({ handoffAt: new Date(), handoffReason: "cliente" })
    );
    await correrTurno();

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual([`enviado:${HANDOFF_BACKUP_ACK}`, "handoff:cliente"]);
  });

  it("es el mismo emisor y el mismo orden que el `farewell` del camino del modelo", async () => {
    // Un texto que el patrón NO atrapa: decide el modelo.
    chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "handoff", reason: "cliente", farewell: "Te paso con el equipo." },
      raw: "{}",
    });
    selectQueue.push(
      [conversacion()],
      [{ profile: perfil, agent: general }],
      historial("esto ya me cansó"),
      [], // kb
      [] // etapas
    );
    await correrTurno();

    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith({
      conversationId: "cv_1",
      organizationId: "org_1",
      text: "Te paso con el equipo.",
      aiGenerated: true,
    });
    expect(eventos).toEqual(["enviado:Te paso con el equipo.", "handoff:modelo"]);
  });
});
