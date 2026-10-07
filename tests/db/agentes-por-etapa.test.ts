import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { describeTimelineItem } from "@/lib/timeline";
import { emptyConfig, type AgentConfig } from "@/server/agents/config";
import {
  assignStage,
  listStageAssignments,
  StageTakenError,
  unassignStage,
} from "@/server/agents/assignments";
import { peekAgentForConversation, resolveAgentForTurn } from "@/server/agents/resolve";
import {
  AgentError,
  archiveAgent,
  createAgent,
  makeGeneral,
  publishAgent,
  saveDraft,
} from "@/server/agents/store";
import { forgetOrgModules } from "@/server/modules";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 031 (PR B) — Agentes por etapa contra Postgres REAL (como `vocero_app`,
 * con RLS): asignación (solo publicados, uno por etapa, confirmación al
 * reemplazar, carrera), resolución del turno (etapa, general, Laboratorio
 * apagado, archivado), `agent_changed` una sola vez por cambio real, la
 * Bandeja («Atiende: …») y el aislamiento de la tabla nueva.
 */

const h = vi.hoisted(() => ({
  llamadas: [] as { role: string; content: string }[][],
}));

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
    sendText: async () => ({ messageId: newId("message"), waMessageId: "wamid.test" }),
  };
});

const { runAgentTurn } = await import("@/server/ai/pipeline");

const sys = () => getSystemDb();
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

let A: Awaited<ReturnType<typeof crearOrganizacion>>;
let B: Awaited<ReturnType<typeof crearOrganizacion>>;
let ACTOR: string;
let stagesA: { id: string; name: string }[];

function cfg(extra: Partial<AgentConfig> = {}): AgentConfig {
  return { ...emptyConfig(), ...extra };
}

async function modulos(org: string, set: { agent?: boolean; lab?: boolean }) {
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: org, agenda: false, ...set })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { agenda: false, ...set } });
  forgetOrgModules(org);
}

/** Un agente publicado (no general) con nombre de presentación. */
async function agentePublicado(org: string, internalName: string, displayName: string) {
  const a = await as(org, () => createAgent({ organizationId: org, actorUserId: ACTOR, internalName }));
  await as(org, () => saveDraft(org, a.id, cfg({ displayName })));
  await as(org, () => publishAgent(org, a.id, ACTOR));
  return a;
}

async function clienteEn(stageId: string, opts: { isTest?: boolean } = {}) {
  const db = sys();
  const contactId = newId("contact");
  const tel = `52155${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  await db.insert(schema.contact).values({ id: contactId, organizationId: A.id, waIdentity: tel, phone: tel, name: "Cliente" });
  const leadId = newId("lead");
  await db.insert(schema.lead).values({ id: leadId, organizationId: A.id, contactId, stageId });
  const conversationId = newId("conversation");
  const now = new Date();
  await db.insert(schema.conversation).values({
    id: conversationId,
    organizationId: A.id,
    contactId,
    isTest: opts.isTest ?? false,
    lastInboundAt: now,
    lastMessageAt: now,
  });
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: A.id,
    conversationId,
    direction: "in",
    type: "text",
    text: "Hola",
    status: "delivered",
    waTimestamp: now,
    createdAt: now,
  });
  return { contactId, leadId, conversationId };
}

async function moverA(leadId: string, stageId: string) {
  await sys().update(schema.lead).set({ stageId }).where(eq(schema.lead.id, leadId));
}

async function turno(conversationId: string) {
  await as(A.id, () => runAgentTurn(conversationId));
}

/** El nombre con que se presentó el agente en el último turno (`Eres "…"`). */
function ultimoNombre(): string | null {
  const system = h.llamadas.at(-1)?.[0]?.content ?? "";
  return /Eres "([^"]+)"/.exec(system)?.[1] ?? null;
}

async function cambios(contactId: string) {
  return sys()
    .select({ detail: schema.contactActivityEvent.detail, source: schema.contactActivityEvent.source })
    .from(schema.contactActivityEvent)
    .where(and(eq(schema.contactActivityEvent.contactId, contactId), eq(schema.contactActivityEvent.kind, "agent_changed")))
    .orderBy(asc(schema.contactActivityEvent.createdAt));
}

beforeAll(async () => {
  process.env.OPENROUTER_API_TOKEN = "sk-test-por-etapa";
  process.env.OPENROUTER_MODEL = "mock/modelo";
  resetEnvCacheForTests();
  A = await crearOrganizacion("Etapas A");
  B = await crearOrganizacion("Etapas B");
  ACTOR = `usr_etapas_${Math.random().toString(36).slice(2, 8)}`;
  await sys().insert(schema.user).values({ id: ACTOR, name: "Dueña Etapas", email: `${ACTOR}@etapas.test` });
  await sys()
    .update(schema.agentProfile)
    .set({ enabled: true, name: "Martillito" })
    .where(eq(schema.agentProfile.organizationId, A.id));
  stagesA = await sys()
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, A.id))
    .orderBy(asc(schema.pipelineStage.position));
});

afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
  await sys().delete(schema.user).where(eq(schema.user.id, ACTOR));
  delete process.env.OPENROUTER_API_TOKEN;
  delete process.env.OPENROUTER_MODEL;
  resetEnvCacheForTests();
});

beforeEach(async () => {
  h.llamadas = [];
  await modulos(A.id, { agent: true, lab: true });
  await sys().delete(schema.agentStageAssignment).where(eq(schema.agentStageAssignment.organizationId, A.id));
});

describe("asignar agentes a etapas", () => {
  it("un borrador no se puede asignar (not_published) y el general tampoco", async () => {
    const borrador = await as(A.id, () => createAgent({ organizationId: A.id, actorUserId: ACTOR, internalName: "Borrador" }));
    await expect(
      as(A.id, () => assignStage(A.id, { stageId: stagesA[0]!.id, agentId: borrador.id, actorUserId: ACTOR }))
    ).rejects.toMatchObject({ code: "not_published" });
    const general = (await as(A.id, () => resolveAgentForTurn(A.id)))!;
    await expect(
      as(A.id, () => assignStage(A.id, { stageId: stagesA[0]!.id, agentId: general.agentId, actorUserId: ACTOR }))
    ).rejects.toBeInstanceOf(AgentError);
    await as(A.id, () => archiveAgent(A.id, borrador.id));
  });

  it("una etapa ocupada pide confirmación (stage_taken); con replace se cambia", async () => {
    const uno = await agentePublicado(A.id, "Uno", "Uno");
    const dos = await agentePublicado(A.id, "Dos", "Dos");
    const etapa = stagesA[1]!.id;
    await as(A.id, () => assignStage(A.id, { stageId: etapa, agentId: uno.id, actorUserId: ACTOR }));
    // Reasignar el mismo no pregunta.
    await as(A.id, () => assignStage(A.id, { stageId: etapa, agentId: uno.id, actorUserId: ACTOR }));
    const err = await as(A.id, () => assignStage(A.id, { stageId: etapa, agentId: dos.id, actorUserId: ACTOR })).catch((e) => e);
    expect(err).toBeInstanceOf(StageTakenError);
    expect((err as StageTakenError).current).toMatchObject({ agentId: uno.id, label: "Uno" });
    await as(A.id, () => assignStage(A.id, { stageId: etapa, agentId: dos.id, actorUserId: ACTOR, replace: true }));
    const mapa = await as(A.id, () => listStageAssignments(A.id));
    expect(mapa.stages.find((s) => s.stageId === etapa)?.agent).toMatchObject({ id: dos.id, problem: null });
    expect(mapa.stages.filter((s) => s.agent)).toHaveLength(1);
    expect(mapa.assignable.map((a) => a.id)).toEqual(expect.arrayContaining([uno.id, dos.id]));
    await as(A.id, () => unassignStage(A.id, etapa));
    expect((await as(A.id, () => listStageAssignments(A.id))).stages.every((s) => !s.agent)).toBe(true);
  });

  it("dos asignaciones a la vez a la misma etapa: una gana, la otra recibe stage_taken", async () => {
    const x = await agentePublicado(A.id, "Carrera X", "X");
    const y = await agentePublicado(A.id, "Carrera Y", "Y");
    const etapa = stagesA[0]!.id;
    const r = await Promise.allSettled([
      as(A.id, () => assignStage(A.id, { stageId: etapa, agentId: x.id, actorUserId: ACTOR })),
      as(A.id, () => assignStage(A.id, { stageId: etapa, agentId: y.id, actorUserId: ACTOR })),
    ]);
    expect(r.filter((p) => p.status === "fulfilled")).toHaveLength(1);
    const rechazo = r.find((p) => p.status === "rejected") as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(StageTakenError);
  });

  it("«Hacer general» le quita sus etapas al agente promovido", async () => {
    const original = (await as(A.id, () => resolveAgentForTurn(A.id)))!;
    const nuevo = await agentePublicado(A.id, "Futuro general", "Futuro");
    await as(A.id, () => assignStage(A.id, { stageId: stagesA[0]!.id, agentId: nuevo.id, actorUserId: ACTOR }));
    await as(A.id, () => makeGeneral(A.id, nuevo.id, ACTOR));
    const filas = await sys().select().from(schema.agentStageAssignment).where(eq(schema.agentStageAssignment.agentId, nuevo.id));
    expect(filas).toHaveLength(0);
    // Deja todo como estaba para las demás pruebas.
    await as(A.id, () => makeGeneral(A.id, original.agentId, ACTOR));
  });
});

describe("qué agente atiende el turno", () => {
  it("la etapa con agente lo usa; sin asignación, el general", async () => {
    const ventas = await agentePublicado(A.id, "Ventas", "Vendedora");
    await as(A.id, () => assignStage(A.id, { stageId: stagesA[1]!.id, agentId: ventas.id, actorUserId: ACTOR }));
    const enVentas = await clienteEn(stagesA[1]!.id);
    await turno(enVentas.conversationId);
    expect(ultimoNombre()).toBe("Vendedora");

    const sinAgente = await clienteEn(stagesA[0]!.id);
    await turno(sinAgente.conversationId);
    expect(ultimoNombre()).toBe("Martillito");
  });

  it("con el módulo Laboratorio apagado se ignoran las asignaciones (atiende el general)", async () => {
    const ventas = await agentePublicado(A.id, "Ventas sin lab", "Vendedor2");
    await as(A.id, () => assignStage(A.id, { stageId: stagesA[1]!.id, agentId: ventas.id, actorUserId: ACTOR }));
    await modulos(A.id, { agent: true, lab: false });
    const c = await clienteEn(stagesA[1]!.id);
    await turno(c.conversationId);
    expect(ultimoNombre()).toBe("Martillito");
    expect(await as(A.id, () => peekAgentForConversation(A.id, c.conversationId))).toBeNull();
  });

  it("un agente archivado cae al general y el mapa lo marca", async () => {
    const viejo = await agentePublicado(A.id, "Por archivar", "Archivable");
    await as(A.id, () => assignStage(A.id, { stageId: stagesA[1]!.id, agentId: viejo.id, actorUserId: ACTOR }));
    await as(A.id, () => archiveAgent(A.id, viejo.id));
    const c = await clienteEn(stagesA[1]!.id);
    await turno(c.conversationId);
    expect(ultimoNombre()).toBe("Martillito");
    const mapa = await as(A.id, () => listStageAssignments(A.id));
    expect(mapa.stages.find((s) => s.stageId === stagesA[1]!.id)?.agent).toMatchObject({ id: viejo.id, problem: "archived" });
    expect(mapa.assignable.map((a) => a.id)).not.toContain(viejo.id);
    // Una asignación que ya no opera se reemplaza sin pedir confirmación.
    const nuevo = await agentePublicado(A.id, "Reemplazo", "Reemplazo");
    await as(A.id, () => assignStage(A.id, { stageId: stagesA[1]!.id, agentId: nuevo.id, actorUserId: ACTOR }));
  });

  it("las conversaciones de prueba no usan la etapa (ni anotan el agente)", async () => {
    const ventas = await agentePublicado(A.id, "Ventas prueba", "Vendedor3");
    await as(A.id, () => assignStage(A.id, { stageId: stagesA[1]!.id, agentId: ventas.id, actorUserId: ACTOR }));
    const c = await clienteEn(stagesA[1]!.id, { isTest: true });
    await turno(c.conversationId);
    expect(ultimoNombre()).toBe("Martillito");
    const [conv] = await sys().select().from(schema.conversation).where(eq(schema.conversation.id, c.conversationId));
    expect(conv!.lastAgentId).toBeNull();
  });
});

describe("agent_changed en la línea de tiempo", () => {
  it("el primer turno solo fija el agente; aparece una vez por cambio real y nunca repetido", async () => {
    const ventas = await agentePublicado(A.id, "Ventas relevo", "Relevo");
    await as(A.id, () => assignStage(A.id, { stageId: stagesA[1]!.id, agentId: ventas.id, actorUserId: ACTOR }));
    const c = await clienteEn(stagesA[0]!.id);

    await turno(c.conversationId); // general: solo fija
    await turno(c.conversationId); // general otra vez: nada
    expect(await cambios(c.contactId)).toHaveLength(0);
    const general = (await sys().select().from(schema.conversation).where(eq(schema.conversation.id, c.conversationId)))[0]!.lastAgentId;
    expect(general).not.toBeNull();

    await moverA(c.leadId, stagesA[1]!.id);
    await turno(c.conversationId); // → Ventas relevo
    await turno(c.conversationId); // mismo: nada
    const peek = await as(A.id, () => peekAgentForConversation(A.id, c.conversationId));
    expect(peek).toMatchObject({ agentId: ventas.id, label: "Ventas relevo", stageName: stagesA[1]!.name });

    await moverA(c.leadId, stagesA[0]!.id);
    await turno(c.conversationId); // → general
    const lista = await cambios(c.contactId);
    expect(lista).toHaveLength(2);
    expect(lista[0]).toMatchObject({ source: "bot", detail: { fromAgentId: general, toAgentId: ventas.id, toName: "Ventas relevo" } });
    expect(lista[1]).toMatchObject({ detail: { fromAgentId: ventas.id, fromName: "Ventas relevo", toAgentId: general } });
    expect(await as(A.id, () => peekAgentForConversation(A.id, c.conversationId))).toBeNull();

    const linea = describeTimelineItem({
      id: "x",
      kind: "agent_changed",
      at: new Date().toISOString(),
      actor: { type: "bot" },
      detail: lista[0]!.detail ?? {},
    });
    expect(linea.title).toBe(`Cambió el agente que atiende: Agente principal → Ventas relevo`);
  });
});

describe("RLS de agent_stage_assignment", () => {
  it("una organización no ve, cambia ni escribe asignaciones de otra", async () => {
    const deB = await agentePublicado(B.id, "De B", "B");
    const [etapaB] = await sys()
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(eq(schema.pipelineStage.organizationId, B.id))
      .limit(1);
    await as(B.id, () => assignStage(B.id, { stageId: etapaB!.id, agentId: deB.id, actorUserId: ACTOR }));

    const vistasDesdeA = await as(A.id, () =>
      getDb().select().from(schema.agentStageAssignment).where(eq(schema.agentStageAssignment.organizationId, B.id))
    );
    expect(vistasDesdeA).toHaveLength(0);
    const borradas = await as(A.id, () =>
      getDb()
        .delete(schema.agentStageAssignment)
        .where(eq(schema.agentStageAssignment.organizationId, B.id))
        .returning()
    );
    expect(borradas).toHaveLength(0);
    await expect(
      as(A.id, () =>
        getDb().insert(schema.agentStageAssignment).values({ organizationId: B.id, stageId: etapaB!.id, agentId: deB.id })
      )
    ).rejects.toThrow();
    // Y por la puerta: la etapa de B no existe para A.
    await expect(
      as(A.id, () => assignStage(A.id, { stageId: etapaB!.id, agentId: deB.id, actorUserId: ACTOR }))
    ).rejects.toThrow("Etapa no encontrada");
    expect(await sys().select().from(schema.agentStageAssignment).where(eq(schema.agentStageAssignment.organizationId, B.id))).toHaveLength(1);
  });
});
