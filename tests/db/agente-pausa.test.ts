import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { emptyConfig, type AgentConfig } from "@/server/agents/config";
import { assignStage } from "@/server/agents/assignments";
import {
  createAgent,
  getAgent,
  getOrgPause,
  listAgents,
  publishAgent,
  saveDraft,
  setAgentPaused,
  setOrgPaused,
} from "@/server/agents/store";
import { forgetOrgModules } from "@/server/modules";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 042 — Interruptores de los agentes contra Postgres REAL (como `vocero_app`,
 * con RLS): la pausa general y la de un agente pasan los chats a una persona
 * (nunca silencio), no tocan asignación, etapa ni no leídos, no gastan IA, no
 * se cruzan entre organizaciones y reanudar deja todo como estaba.
 */

const h = vi.hoisted(() => ({ llamadas: [] as { role: string; content: string }[][], enviados: [] as string[] }));

vi.mock("@/lib/ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...real,
    chatJson: async (_schema: unknown, messages: { role: string; content: string }[]) => {
      h.llamadas.push(messages);
      return { ok: true, data: { action: "reply", text: "hola" }, raw: "", usage: { promptTokens: 1, completionTokens: 1 } };
    },
  };
});

vi.mock("@/server/inbox/send", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/inbox/send")>();
  return {
    ...real,
    sendText: async (input: { text: string }) => {
      h.enviados.push(input.text);
      return { messageId: newId("message"), waMessageId: "wamid.test" };
    },
  };
});

// El cerebro externo: la llave "key-A" es de la organización A, "key-B" de B.
const llaves = vi.hoisted(() => new Map<string, string>());
vi.mock("@/server/bot/keys", () => ({
  resolveBotKey: async (k: string | null) => {
    const org = k ? llaves.get(k) : undefined;
    return org ? { keyId: `bak_${org}`, organizationId: org } : null;
  },
  touchBotKey: async () => {},
}));

const { runAgentTurn } = await import("@/server/ai/pipeline");
const botMessages = await import("@/app/api/bot/messages/route");
const botTyping = await import("@/app/api/bot/typing/route");
const botContext = await import("@/app/api/bot/context/route");

const bot = (path: string, key: string, body?: unknown) =>
  new Request(`http://localhost/api/bot/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

const sys = () => getSystemDb();
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
let A: Org;
let B: Org;
let ACTOR: string;
let asesor: string;
const stages: Record<string, { id: string; name: string }[]> = {};

const cfg = (extra: Partial<AgentConfig> = {}): AgentConfig => ({ ...emptyConfig(), ...extra });

async function modulos(org: string) {
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: org, agenda: false, agent: true, lab: true })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { agenda: false, agent: true, lab: true } });
  forgetOrgModules(org);
}

/** Un cliente real en la etapa `stageId` de `org`, asignado al asesor, con 2 sin leer. */
async function cliente(org: string, stageId: string, opts: { isTest?: boolean; text?: string } = {}) {
  const db = sys();
  const contactId = newId("contact");
  const tel = `52155${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  await db.insert(schema.contact).values({
    id: contactId,
    organizationId: org,
    waIdentity: tel,
    phone: tel,
    name: "Cliente",
    assignedUserId: asesor,
  });
  await db.insert(schema.lead).values({ id: newId("lead"), organizationId: org, contactId, stageId });
  const conversationId = newId("conversation");
  const now = new Date();
  await db.insert(schema.conversation).values({
    id: conversationId,
    organizationId: org,
    contactId,
    isTest: opts.isTest ?? false,
    lastInboundAt: now,
    lastMessageAt: now,
    unreadCount: 2,
  });
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: org,
    conversationId,
    direction: "in",
    type: "text",
    text: opts.text ?? "Hola",
    status: "delivered",
    waTimestamp: now,
    createdAt: now,
  });
  return { contactId, conversationId };
}

async function turno(org: string, conversationId: string) {
  await as(org, () => runAgentTurn(conversationId));
}

async function conversacion(id: string) {
  const [c] = await sys().select().from(schema.conversation).where(eq(schema.conversation.id, id));
  return c!;
}

async function agentePublicado(org: string, name: string) {
  const a = await as(org, () => createAgent({ organizationId: org, actorUserId: ACTOR, internalName: name }));
  await as(org, () => saveDraft(org, a.id, cfg({ displayName: name })));
  await as(org, () => publishAgent(org, a.id, ACTOR));
  return a;
}

async function generalDe(org: string) {
  const [g] = await sys()
    .select()
    .from(schema.agent)
    .where(and(eq(schema.agent.organizationId, org), eq(schema.agent.isGeneral, true)));
  return g!;
}

beforeAll(async () => {
  process.env.OPENROUTER_API_TOKEN = "sk-test-pausa";
  process.env.OPENROUTER_MODEL = "mock/modelo";
  resetEnvCacheForTests();
  A = await crearOrganizacion("Pausa A");
  B = await crearOrganizacion("Pausa B");
  llaves.set("key-A", A.id);
  llaves.set("key-B", B.id);
  ACTOR = `usr_pausa_${Math.random().toString(36).slice(2, 8)}`;
  asesor = `usr_asesor_${Math.random().toString(36).slice(2, 8)}`;
  await sys().insert(schema.user).values([
    { id: ACTOR, name: "Dueña Pausa", email: `${ACTOR}@pausa.test` },
    { id: asesor, name: "Asesor Pausa", email: `${asesor}@pausa.test` },
  ]);
  for (const o of [A, B]) {
    await sys().update(schema.agentProfile).set({ enabled: true, name: "Martillito" }).where(eq(schema.agentProfile.organizationId, o.id));
    stages[o.id] = await sys()
      .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
      .from(schema.pipelineStage)
      .where(eq(schema.pipelineStage.organizationId, o.id))
      .orderBy(asc(schema.pipelineStage.position));
  }
});

afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
  await sys().delete(schema.user).where(eq(schema.user.id, ACTOR));
  await sys().delete(schema.user).where(eq(schema.user.id, asesor));
  delete process.env.OPENROUTER_API_TOKEN;
  delete process.env.OPENROUTER_MODEL;
  resetEnvCacheForTests();
});

beforeEach(async () => {
  h.llamadas = [];
  h.enviados = [];
  await modulos(A.id);
  await modulos(B.id);
  await as(A.id, () => setOrgPaused(A.id, ACTOR, false));
  await as(B.id, () => setOrgPaused(B.id, ACTOR, false));
  await sys().delete(schema.agentStageAssignment).where(eq(schema.agentStageAssignment.organizationId, A.id));
  await sys().update(schema.agent).set({ pausedAt: null }).where(eq(schema.agent.organizationId, A.id));
});

describe("interruptor general", () => {
  it("sin pausa el agente responde (línea base)", async () => {
    const { conversationId } = await cliente(A.id, stages[A.id]![0]!.id);
    await turno(A.id, conversationId);
    expect(h.llamadas).toHaveLength(1);
    expect(h.enviados).toEqual(["hola"]);
    expect((await conversacion(conversationId)).handoffAt).toBeNull();
  });

  it("en pausa el chat pasa a una persona: sin modelo, sin mensaje, sin tocar asignación, etapa ni no leídos", async () => {
    const etapa = stages[A.id]![1]!.id;
    const { contactId, conversationId } = await cliente(A.id, etapa);
    await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    await turno(A.id, conversationId);

    expect(h.llamadas).toHaveLength(0);
    expect(h.enviados).toHaveLength(0);
    const conv = await conversacion(conversationId);
    expect(conv.handoffAt).not.toBeNull();
    expect(conv.handoffReason).toBe("pausa");
    expect(conv.unreadCount).toBe(2);
    expect(conv.aiEnabled).toBe(true);
    const [contact] = await sys().select().from(schema.contact).where(eq(schema.contact.id, contactId));
    expect(contact!.assignedUserId).toBe(asesor);
    const [lead] = await sys().select().from(schema.lead).where(eq(schema.lead.contactId, contactId));
    expect(lead!.stageId).toBe(etapa);
    // Queda en la línea de tiempo como cualquier traspaso.
    const eventos = await sys()
      .select({ detail: schema.contactActivityEvent.detail })
      .from(schema.contactActivityEvent)
      .where(and(eq(schema.contactActivityEvent.contactId, contactId), eq(schema.contactActivityEvent.kind, "ai_handoff")));
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.detail).toMatchObject({ reason: "pausa" });
  });

  it("pedir una persona estando en pausa no hace que el agente conteste el aviso", async () => {
    const { conversationId } = await cliente(A.id, stages[A.id]![0]!.id, { text: "quiero hablar con un humano" });
    await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    await turno(A.id, conversationId);
    expect(h.enviados).toHaveLength(0);
    expect((await conversacion(conversationId)).handoffReason).toBe("pausa");
  });

  it("el Laboratorio (chats de prueba) no se pausa", async () => {
    const { conversationId } = await cliente(A.id, stages[A.id]![0]!.id, { isTest: true });
    await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    await turno(A.id, conversationId);
    expect(h.llamadas).toHaveLength(1);
    expect((await conversacion(conversationId)).handoffAt).toBeNull();
  });

  it("un chat que ya estaba con una persona no se toca (conserva su motivo)", async () => {
    const { conversationId } = await cliente(A.id, stages[A.id]![0]!.id);
    await sys().update(schema.conversation).set({ handoffAt: new Date(), handoffReason: "cliente" }).where(eq(schema.conversation.id, conversationId));
    await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    await turno(A.id, conversationId);
    expect((await conversacion(conversationId)).handoffReason).toBe("cliente");
  });

  it("pausar es idempotente (conserva la hora) y reanudar devuelve la respuesta sin tocar la configuración", async () => {
    const general = await generalDe(A.id);
    const antes = JSON.stringify([general.draft, general.published]);
    const uno = await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    const dos = await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    expect(dos.pausedAt).toBe(uno.pausedAt);
    expect(await as(A.id, () => getOrgPause(A.id))).toMatchObject({ paused: true });
    const reanudado = await as(A.id, () => setOrgPaused(A.id, ACTOR, false));
    expect(reanudado).toEqual({ paused: false, pausedAt: null });

    const despues = await generalDe(A.id);
    expect(JSON.stringify([despues.draft, despues.published])).toBe(antes);
    const { conversationId } = await cliente(A.id, stages[A.id]![0]!.id);
    await turno(A.id, conversationId);
    expect(h.enviados).toEqual(["hola"]);
  });
});

describe("interruptor por agente", () => {
  it("el agente de la etapa apagado pasa su chat a una persona; los demás chats siguen con el general", async () => {
    const ventas = await agentePublicado(A.id, "Ventas");
    const etapaVentas = stages[A.id]![1]!.id;
    await as(A.id, () => assignStage(A.id, { stageId: etapaVentas, agentId: ventas.id, actorUserId: ACTOR }));
    await as(A.id, () => setAgentPaused(A.id, ventas.id, ACTOR, true));

    const enVentas = await cliente(A.id, etapaVentas);
    const enOtra = await cliente(A.id, stages[A.id]![0]!.id);
    await turno(A.id, enVentas.conversationId);
    await turno(A.id, enOtra.conversationId);

    const apagado = await conversacion(enVentas.conversationId);
    expect(apagado.handoffReason).toBe("pausa");
    expect(apagado.unreadCount).toBe(2);
    expect((await conversacion(enOtra.conversationId)).handoffAt).toBeNull();
    expect(h.enviados).toEqual(["hola"]); // solo el del general

    await as(A.id, () => setAgentPaused(A.id, ventas.id, ACTOR, false));
    const otro = await cliente(A.id, etapaVentas);
    await turno(A.id, otro.conversationId);
    expect((await conversacion(otro.conversationId)).handoffAt).toBeNull();
  });

  it("apagar el agente general pasa a una persona los chats sin agente de etapa", async () => {
    const general = await generalDe(A.id);
    await as(A.id, () => setAgentPaused(A.id, general.id, ACTOR, true));
    const { conversationId } = await cliente(A.id, stages[A.id]![0]!.id);
    await turno(A.id, conversationId);
    expect((await conversacion(conversationId)).handoffReason).toBe("pausa");
    expect(h.llamadas).toHaveLength(0);
    const lista = await as(A.id, () => listAgents(A.id));
    expect(lista.find((a) => a.isGeneral)?.paused).toBe(true);
  });

  it("apagar un agente no cambia su configuración", async () => {
    const ventas = await agentePublicado(A.id, "Ventas 2");
    const antes = await as(A.id, () => getAgent(A.id, ventas.id));
    await as(A.id, () => setAgentPaused(A.id, ventas.id, ACTOR, true));
    const despues = await as(A.id, () => getAgent(A.id, ventas.id));
    expect(despues!.draft).toEqual(antes!.draft);
    expect(despues!.published).toEqual(antes!.published);
    expect(despues!.status).toBe("published");
  });
});

describe("aislamiento entre organizaciones", () => {
  it("pausar A no pausa a B", async () => {
    await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    const enB = await cliente(B.id, stages[B.id]![0]!.id);
    await turno(B.id, enB.conversationId);
    expect((await conversacion(enB.conversationId)).handoffAt).toBeNull();
    expect(h.enviados).toEqual(["hola"]);
    expect(await as(B.id, () => getOrgPause(B.id))).toMatchObject({ paused: false });
  });

  it("desde B no se ve ni se mueve el interruptor de un agente de A (RLS)", async () => {
    const ventas = await agentePublicado(A.id, "Solo de A");
    await expect(as(B.id, () => setAgentPaused(B.id, ventas.id, ACTOR, true))).rejects.toMatchObject({ code: "not_found" });
    const [fila] = await sys().select().from(schema.agent).where(eq(schema.agent.id, ventas.id));
    expect(fila!.pausedAt).toBeNull();
    // El pausado general de A tampoco se lee desde B.
    await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    expect((await as(B.id, () => getOrgPause(B.id))).paused).toBe(false);
  });
});

describe("al reanudar, los chats que ya pasaron a una persona NO regresan solos al agente", () => {
  it("se quedan con la persona; solo los chats nuevos vuelven al agente", async () => {
    const etapa = stages[A.id]![0]!.id;
    const viejo = await cliente(A.id, etapa);
    await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    await turno(A.id, viejo.conversationId);
    const traspasado = await conversacion(viejo.conversationId);
    expect(traspasado.handoffReason).toBe("pausa");

    await as(A.id, () => setOrgPaused(A.id, ACTOR, false));
    // El cliente vuelve a escribir en ese mismo chat, ya reanudado.
    await sys().insert(schema.message).values({
      id: newId("message"), organizationId: A.id, conversationId: viejo.conversationId,
      direction: "in", type: "text", text: "¿hay alguien?", status: "delivered",
      waTimestamp: new Date(), createdAt: new Date(),
    });
    h.enviados = [];
    await turno(A.id, viejo.conversationId);
    expect(h.enviados).toHaveLength(0);
    expect(h.llamadas).toHaveLength(0);
    const despues = await conversacion(viejo.conversationId);
    expect(despues.handoffAt?.getTime()).toBe(traspasado.handoffAt?.getTime());
    expect(despues.handoffReason).toBe("pausa");

    const nuevo = await cliente(A.id, etapa);
    await turno(A.id, nuevo.conversationId);
    expect(h.enviados).toEqual(["hola"]);
  });
});

describe("cerebro externo (/api/bot/*) respeta la pausa", () => {
  it("sin pausa, el envío del cerebro pasa (línea base)", async () => {
    const { conversationId } = await cliente(A.id, stages[A.id]![0]!.id);
    const r = await botMessages.POST(bot("messages", "key-A", { conversationId, text: "hola desde el cerebro" }));
    expect(r.status).toBe(200);
    expect(h.enviados).toEqual(["hola desde el cerebro"]);
  });

  it("pausa general: 409 ai_paused, no se envía nada y el chat pasa a una persona", async () => {
    const { conversationId } = await cliente(A.id, stages[A.id]![0]!.id);
    await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    const r = await botMessages.POST(bot("messages", "key-A", { conversationId, text: "hola" }));
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("ai_paused");
    expect(h.enviados).toHaveLength(0);
    const conv = await conversacion(conversationId);
    expect(conv.handoffReason).toBe("pausa");
    expect(conv.unreadCount).toBe(2);
    // Y sigue respondiendo lo mismo que cualquier traspaso.
    const otra = await botMessages.POST(bot("messages", "key-A", { conversationId, text: "otra vez" }));
    expect(otra.status).toBe(409);
  });

  it("interruptor del agente general: también calla al cerebro", async () => {
    const { conversationId } = await cliente(A.id, stages[A.id]![0]!.id);
    const general = await generalDe(A.id);
    await as(A.id, () => setAgentPaused(A.id, general.id, ACTOR, true));
    const r = await botMessages.POST(bot("messages", "key-A", { conversationId, text: "hola" }));
    expect(r.status).toBe(409);
    expect(h.enviados).toHaveLength(0);
  });

  it("'escribiendo…' y el contexto lo reflejan sin tocar nada (solo lectura)", async () => {
    const { conversationId } = await cliente(A.id, stages[A.id]![0]!.id);
    await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    const t = await botTyping.POST(bot("typing", "key-A", { conversationId }));
    expect(await t.json()).toEqual({ ok: false, reason: "ai_paused" });
    const c = await botContext.GET(bot(`context?conversationId=${conversationId}`, "key-A"));
    const cuerpo = await c.json();
    expect(cuerpo.conversation.aiEnabled).toBe(false);
    expect(cuerpo.conversation.paused).toBe(true);
    expect((await conversacion(conversationId)).handoffAt).toBeNull();
  });

  it("pausar A no frena el cerebro de B", async () => {
    await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    const enB = await cliente(B.id, stages[B.id]![0]!.id);
    const r = await botMessages.POST(bot("messages", "key-B", { conversationId: enB.conversationId, text: "hola B" }));
    expect(r.status).toBe(200);
  });

  it("el chat de prueba del Laboratorio no se pausa (cae en su guarda de sandbox, no en ai_paused)", async () => {
    const { conversationId } = await cliente(A.id, stages[A.id]![0]!.id, { isTest: true });
    await as(A.id, () => setOrgPaused(A.id, ACTOR, true));
    const r = await botMessages.POST(bot("messages", "key-A", { conversationId, text: "hola" }));
    expect((await r.json()).error?.code).not.toBe("ai_paused");
    expect((await conversacion(conversationId)).handoffAt).toBeNull();
  });
});
