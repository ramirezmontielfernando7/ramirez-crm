import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { HANDOFF_BACKUP_ACK } from "@/server/ai/handoff";
import { forgetOrgModules } from "@/server/modules";
import { forgetOrgStatus } from "@/server/platform-admin/org-status";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 031 (PR A1) — Caracterización del turno del agente contra Postgres REAL.
 *
 * Fija lo que `runAgentTurn` hace HOY, camino por camino, para que el
 * refactor (contexto → decisión → ejecución) y el cambio de la fuente de la
 * configuración (`agent_profile` → agente general publicado) no muevan nada.
 * Solo se simulan las dos salidas al mundo: el modelo (`chatJson`) y el envío
 * a Meta (`sendText`). Todo lo demás —cuota, módulos, bitácoras, etapas,
 * traspasos— corre de verdad.
 */

const h = vi.hoisted(() => ({
  respuesta: null as null | (() => unknown),
  llamadasLlm: [] as { role: string; content: string }[][],
  enviados: [] as { conversationId: string; text: string }[],
  falloEnvio: null as null | "window_closed",
}));

vi.mock("@/lib/ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...real,
    chatJson: async (_schema: unknown, messages: { role: string; content: string }[]) => {
      h.llamadasLlm.push(messages);
      const r = h.respuesta?.() ?? { ok: true, data: { action: "none" }, raw: "" };
      return r;
    },
  };
});

vi.mock("@/server/inbox/send", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/inbox/send")>();
  return {
    ...real,
    sendText: async (input: { conversationId: string; text: string }) => {
      if (h.falloEnvio === "window_closed") {
        throw new real.SendError("window_closed", "ventana cerrada");
      }
      h.enviados.push({ conversationId: input.conversationId, text: input.text });
      return { messageId: newId("message"), waMessageId: "wamid.test" };
    },
  };
});

const { runAgentTurn } = await import("@/server/ai/pipeline");

const sys = () => getSystemDb();

function responde(data: unknown) {
  h.respuesta = () => ({ ok: true, data, raw: JSON.stringify(data), usage: { promptTokens: 10, completionTokens: 5 } });
}

type Escenario = {
  conversationId: string;
  contactId: string;
  leadId: string;
  stages: { id: string; name: string; kind: string }[];
};

let A: Awaited<ReturnType<typeof crearOrganizacion>>;

async function escenario(opts: {
  isTest?: boolean;
  aiEnabled?: boolean;
  handoff?: boolean;
  lastInboundAt?: Date;
  texto?: string;
  conMensaje?: boolean;
} = {}): Promise<Escenario> {
  const db = sys();
  const contactId = newId("contact");
  const tel = `52155${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  await db.insert(schema.contact).values({
    id: contactId,
    organizationId: A.id,
    waIdentity: tel,
    phone: tel,
    name: "Cliente prueba",
  });
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name, kind: schema.pipelineStage.kind })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, A.id))
    .orderBy(asc(schema.pipelineStage.position));
  const leadId = newId("lead");
  await db.insert(schema.lead).values({ id: leadId, organizationId: A.id, contactId, stageId: stages[0]!.id });
  const conversationId = newId("conversation");
  const lastInboundAt = opts.lastInboundAt ?? new Date();
  await db.insert(schema.conversation).values({
    id: conversationId,
    organizationId: A.id,
    contactId,
    isTest: opts.isTest ?? false,
    aiEnabled: opts.aiEnabled ?? true,
    handoffAt: opts.handoff ? new Date() : null,
    lastInboundAt,
    lastMessageAt: lastInboundAt,
  });
  if (opts.conMensaje !== false) {
    await db.insert(schema.message).values({
      id: newId("message"),
      organizationId: A.id,
      conversationId,
      direction: "in",
      type: "text",
      text: opts.texto ?? "Hola, ¿qué venden?",
      status: "delivered",
      waTimestamp: lastInboundAt,
      createdAt: lastInboundAt,
    });
  }
  return { conversationId, contactId, leadId, stages };
}

async function turno(conversationId: string) {
  await runWithOrganization(A.id, () => runAgentTurn(conversationId));
}

async function conversacion(id: string) {
  const [c] = await sys().select().from(schema.conversation).where(eq(schema.conversation.id, id));
  return c!;
}

async function salientes(id: string) {
  return sys()
    .select({ text: schema.message.text, aiGenerated: schema.message.aiGenerated })
    .from(schema.message)
    .where(and(eq(schema.message.conversationId, id), eq(schema.message.direction, "out")))
    .orderBy(asc(schema.message.createdAt));
}

async function eventos(contactId: string) {
  return sys()
    .select({ kind: schema.contactActivityEvent.kind, detail: schema.contactActivityEvent.detail, source: schema.contactActivityEvent.source })
    .from(schema.contactActivityEvent)
    .where(eq(schema.contactActivityEvent.contactId, contactId))
    .orderBy(asc(schema.contactActivityEvent.createdAt));
}

async function perfil(set: Partial<typeof schema.agentProfile.$inferInsert>) {
  await sys().update(schema.agentProfile).set(set).where(eq(schema.agentProfile.organizationId, A.id));
}

async function modulos(set: { agent?: boolean; lab?: boolean }) {
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: A.id, agenda: false, ...set })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { agenda: false, ...set } });
  forgetOrgModules(A.id);
}

beforeAll(async () => {
  process.env.OPENROUTER_API_TOKEN = "sk-test-caracterizacion";
  process.env.OPENROUTER_MODEL = "mock/modelo";
  resetEnvCacheForTests();
  A = await crearOrganizacion("Turno A");
  await modulos({ agent: true, lab: true });
  await perfil({ enabled: true, name: "Martillito", tone: "Cercano", instructions: "Vende clavos." });
  await sys().insert(schema.kbEntry).values({
    id: newId("kbEntry"),
    organizationId: A.id,
    kind: "qa",
    question: "¿Qué venden?",
    answer: "Clavos y martillos.",
  });
});

afterAll(async () => {
  await borrarOrganizaciones([A.id]);
  delete process.env.OPENROUTER_API_TOKEN;
  delete process.env.OPENROUTER_MODEL;
  resetEnvCacheForTests();
});

beforeEach(async () => {
  h.respuesta = null;
  h.llamadasLlm = [];
  h.enviados = [];
  h.falloEnvio = null;
  await perfil({ enabled: true });
  await modulos({ agent: true, lab: true });
  await sys().update(schema.organization).set({ status: "active" }).where(eq(schema.organization.id, A.id));
  forgetOrgStatus(A.id);
});

describe("condiciones de silencio (no se llama al modelo ni se envía nada)", () => {
  it("organización suspendida", async () => {
    await sys().update(schema.organization).set({ status: "suspended" }).where(eq(schema.organization.id, A.id));
    forgetOrgStatus(A.id);
    const e = await escenario();
    responde({ action: "reply", text: "hola" });
    await turno(e.conversationId);
    expect(h.llamadasLlm).toHaveLength(0);
    expect(h.enviados).toHaveLength(0);
  });

  it("módulo Agente apagado (conversación real)", async () => {
    await modulos({ agent: false, lab: false });
    const e = await escenario();
    responde({ action: "reply", text: "hola" });
    await turno(e.conversationId);
    expect(h.llamadasLlm).toHaveLength(0);
  });

  it("módulo Laboratorio apagado (conversación de prueba)", async () => {
    await modulos({ agent: true, lab: false });
    const e = await escenario({ isTest: true });
    responde({ action: "reply", text: "hola" });
    await turno(e.conversationId);
    expect(h.llamadasLlm).toHaveLength(0);
    expect(await salientes(e.conversationId)).toHaveLength(0);
  });

  it("conversación en traspaso (handoffAt)", async () => {
    const e = await escenario({ handoff: true });
    responde({ action: "reply", text: "hola" });
    await turno(e.conversationId);
    expect(h.llamadasLlm).toHaveLength(0);
  });

  it("IA apagada en la conversación", async () => {
    const e = await escenario({ aiEnabled: false });
    responde({ action: "reply", text: "hola" });
    await turno(e.conversationId);
    expect(h.llamadasLlm).toHaveLength(0);
  });

  it("interruptor global apagado: calla en una conversación real…", async () => {
    await perfil({ enabled: false });
    const e = await escenario();
    responde({ action: "reply", text: "hola" });
    await turno(e.conversationId);
    expect(h.llamadasLlm).toHaveLength(0);
  });

  it("…pero el Laboratorio (is_test) lo ignora y responde en el sandbox", async () => {
    await perfil({ enabled: false });
    const e = await escenario({ isTest: true });
    responde({ action: "reply", text: "Respuesta de prueba" });
    await turno(e.conversationId);
    expect(h.llamadasLlm).toHaveLength(1);
    expect(h.enviados).toHaveLength(0);
    expect(await salientes(e.conversationId)).toEqual([{ text: "Respuesta de prueba", aiGenerated: true }]);
  });

  it("sin mensaje entrante no hay turno", async () => {
    const e = await escenario({ conMensaje: false });
    responde({ action: "reply", text: "hola" });
    await turno(e.conversationId);
    expect(h.llamadasLlm).toHaveLength(0);
  });
});

describe("antes del modelo", () => {
  it("ventana de 24 h cerrada → traspaso `ventana` sin llamar al modelo", async () => {
    const e = await escenario({ lastInboundAt: new Date(Date.now() - 25 * 3600 * 1000) });
    await turno(e.conversationId);
    expect(h.llamadasLlm).toHaveLength(0);
    const c = await conversacion(e.conversationId);
    expect(c.handoffReason).toBe("ventana");
    expect(c.handoffAt).not.toBeNull();
    expect((await eventos(e.contactId)).map((x) => x.kind)).toEqual(["ai_handoff"]);
  });

  it("patrón de respaldo → acuse fijo y traspaso `cliente`, sin modelo", async () => {
    const e = await escenario({ texto: "quiero hablar con un asesor por favor" });
    await turno(e.conversationId);
    expect(h.llamadasLlm).toHaveLength(0);
    expect(h.enviados.map((x) => x.text)).toEqual([HANDOFF_BACKUP_ACK]);
    expect((await conversacion(e.conversationId)).handoffReason).toBe("cliente");
  });
});

describe("resultado del modelo", () => {
  it("el prompt lleva el perfil, el KB y las etapas; el historial va después", async () => {
    const e = await escenario();
    responde({ action: "none" });
    await turno(e.conversationId);
    const msgs = h.llamadasLlm[0]!;
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[0]!.content.startsWith('Eres "Martillito", el asistente de WhatsApp de este negocio.')).toBe(true);
    expect(msgs[0]!.content).toContain("Tono: Cercano");
    expect(msgs[0]!.content).toContain("P: ¿Qué venden?\nR: Clavos y martillos.");
    expect(msgs[0]!.content).toContain("Etapas del pipeline disponibles: Etapa 0 | Etapa 1 | Etapa 2 | Etapa 3");
    expect(msgs.slice(1)).toEqual([{ role: "user", content: "Hola, ¿qué venden?" }]);
  });

  it("cuota agotada → traspaso `cuota` (real)", async () => {
    h.respuesta = () => ({ ok: false, error: "quota_exceeded", detail: "tope" });
    const e = await escenario();
    await turno(e.conversationId);
    expect((await conversacion(e.conversationId)).handoffReason).toBe("cuota");
  });

  it("cuota agotada en el Laboratorio → solo calla", async () => {
    h.respuesta = () => ({ ok: false, error: "quota_exceeded", detail: "tope" });
    const e = await escenario({ isTest: true });
    await turno(e.conversationId);
    const c = await conversacion(e.conversationId);
    expect(c.handoffAt).toBeNull();
  });

  it("fallo del proveedor → traspaso `error`", async () => {
    h.respuesta = () => ({ ok: false, error: "provider_error", detail: "500" });
    const e = await escenario();
    await turno(e.conversationId);
    expect((await conversacion(e.conversationId)).handoffReason).toBe("error");
    expect(h.enviados).toHaveLength(0);
  });

  it("reply → se envía a WhatsApp como IA", async () => {
    responde({ action: "reply", text: "Vendemos clavos." });
    const e = await escenario();
    await turno(e.conversationId);
    expect(h.enviados).toEqual([{ conversationId: e.conversationId, text: "Vendemos clavos." }]);
    expect((await conversacion(e.conversationId)).handoffAt).toBeNull();
  });

  it("reply con la ventana cerrada al enviar → traspaso `ventana`", async () => {
    h.falloEnvio = "window_closed";
    responde({ action: "reply", text: "hola" });
    const e = await escenario();
    await turno(e.conversationId);
    expect((await conversacion(e.conversationId)).handoffReason).toBe("ventana");
  });

  it("none → nada", async () => {
    responde({ action: "none" });
    const e = await escenario();
    await turno(e.conversationId);
    expect(h.enviados).toHaveLength(0);
    expect(await eventos(e.contactId)).toHaveLength(0);
  });

  it("update_lead → nota en la línea de tiempo (por el agente) + reply", async () => {
    responde({ action: "update_lead", note: "Quiere 3 cajas", reply: "Anotado." });
    const e = await escenario();
    await turno(e.conversationId);
    const ev = await eventos(e.contactId);
    expect(ev).toEqual([{ kind: "note_added", detail: { text: "Quiere 3 cajas" }, source: "bot" }]);
    expect(h.enviados.map((x) => x.text)).toEqual(["Anotado."]);
  });

  it("move_stage válida → mueve el lead (bitácora) + reply", async () => {
    const e = await escenario();
    responde({ action: "move_stage", stage: "etapa 1", reply: "¡Te aparto!" });
    await turno(e.conversationId);
    const [l] = await sys().select().from(schema.lead).where(eq(schema.lead.id, e.leadId));
    expect(l!.stageId).toBe(e.stages[1]!.id);
    expect(h.enviados.map((x) => x.text)).toEqual(["¡Te aparto!"]);
    const hist = await sys()
      .select({ to: schema.leadStageEvent.toStageId, source: schema.leadStageEvent.source })
      .from(schema.leadStageEvent)
      .where(eq(schema.leadStageEvent.leadId, e.leadId));
    expect(hist).toContainEqual({ to: e.stages[1]!.id, source: "bot" });
  });

  it("move_stage a una etapa que no existe → degrada a su reply", async () => {
    const e = await escenario();
    responde({ action: "move_stage", stage: "No existe", reply: "Te ayudo." });
    await turno(e.conversationId);
    const [l] = await sys().select().from(schema.lead).where(eq(schema.lead.id, e.leadId));
    expect(l!.stageId).toBe(e.stages[0]!.id);
    expect(h.enviados.map((x) => x.text)).toEqual(["Te ayudo."]);
  });

  it("move_stage a la etapa perdida → la puerta lo rechaza y el lead no se mueve", async () => {
    const e = await escenario();
    responde({ action: "move_stage", stage: "Etapa 3" });
    await turno(e.conversationId);
    const [l] = await sys().select().from(schema.lead).where(eq(schema.lead.id, e.leadId));
    expect(l!.stageId).toBe(e.stages[0]!.id);
  });

  it("handoff con farewell → despedida y traspaso `modelo`", async () => {
    responde({ action: "handoff", reason: "x", farewell: "Te paso con alguien." });
    const e = await escenario();
    await turno(e.conversationId);
    expect(h.enviados.map((x) => x.text)).toEqual(["Te paso con alguien."]);
    expect((await conversacion(e.conversationId)).handoffReason).toBe("modelo");
  });

  it("handoff sin farewell → solo traspaso", async () => {
    responde({ action: "handoff" });
    const e = await escenario();
    await turno(e.conversationId);
    expect(h.enviados).toHaveLength(0);
    expect((await conversacion(e.conversationId)).handoffReason).toBe("modelo");
  });

  it("offer_slots con la agenda apagada → el esquema del turno no la admite (falla de salida → error)", async () => {
    // Con la agenda apagada, el esquema que se le exige al modelo no conoce
    // offer_slots: el adaptador real lo trataría como salida inválida. Aquí
    // el doble de chatJson la devuelve tal cual y el pipeline la DEGRADA a
    // su reply (camino defensivo de `degradeAction`).
    responde({ action: "offer_slots", reply: "Mira estos horarios" });
    const e = await escenario();
    await turno(e.conversationId);
    expect(h.enviados.map((x) => x.text)).toEqual(["Mira estos horarios"]);
    const msgs = h.llamadasLlm[0]!;
    expect(msgs[0]!.content).not.toContain("offer_slots");
  });

  it("el turno consume cuota de su organización con su tipo", async () => {
    responde({ action: "none" });
    const e = await escenario();
    await turno(e.conversationId);
    const filas = await sys()
      .select({ kind: schema.aiUsage.kind })
      .from(schema.aiUsage)
      .where(eq(schema.aiUsage.organizationId, A.id));
    expect(filas.map((f) => f.kind)).toContain("agent");
    void e;
  });
});
