/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON-RPC sin tipar en la prueba */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sessionContext } from "@/lib/auth/session";
import { runWithOrganization } from "@/lib/request-context";
import { createPersonalKey, renameAssistant } from "@/server/ai-connector/keys";
import { saveConnectorSettings } from "@/server/ai-connector/settings";
import { forgetOrgModules } from "@/server/modules/store";
import { POST } from "@/app/api/mcp/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 047 PR 4 — Las acciones de la IA conectada contra Postgres real: envía
 * como la persona (con su tope diario y la marca «Enviado por IA»),
 * etiqueta, mueve de etapa, anota, crea tareas y asigna solo si la persona
 * puede. Nada de esto alcanza un chat que la persona no ve.
 */

type Role = "owner" | "coordinador" | "asesor";
const sys = () => getSystemDb();

let A: Awaited<ReturnType<typeof crearOrganizacion>>;
const u = { owner: "", ana: "", beto: "" };
const chats = { deAna: "", deBeto: "", cerrado: "" };
const contactos = { deAna: "" };
const metaCalls: string[] = [];

async function persona(orgId: string, role: Role, name: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@acciones.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role });
  return id;
}

async function chat(orgId: string, asignadoA: string, inbound: Date | null) {
  const contactId = newId("contact");
  const tel = `52155${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  await sys()
    .insert(schema.contact)
    .values({ id: contactId, organizationId: orgId, waIdentity: tel, phone: tel, name: `Cliente ${tel.slice(-4)}`, assignedUserId: asignadoA });
  const [stage] = await sys()
    .select()
    .from(schema.pipelineStage)
    .where(and(eq(schema.pipelineStage.organizationId, orgId), eq(schema.pipelineStage.position, 0)));
  await sys().insert(schema.lead).values({ id: newId("lead"), organizationId: orgId, contactId, stageId: stage!.id });
  const conversationId = newId("conversation");
  await sys()
    .insert(schema.conversation)
    .values({ id: conversationId, organizationId: orgId, contactId, lastMessageAt: new Date(), lastInboundAt: inbound });
  return { conversationId, contactId };
}

async function llave(userId: string, role: Role, scopes: ("read" | "write")[] = ["read", "write"]) {
  const made = await runWithOrganization(A.id, () =>
    createPersonalKey(sessionContext(userId, A.id, role), { name: "Claude de prueba", scopes })
  );
  if (!made) throw new Error("no se pudo crear la llave");
  return made.key;
}

async function ajustes(dailyMessageLimit: number) {
  await runWithOrganization(A.id, () =>
    saveConnectorSettings(A.id, u.owner, { enabled: true, allowedRoles: ["coordinador", "asesor"], dailyMessageLimit })
  );
}

let seq = 0;
async function rpc(key: string, method: string, params?: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }),
    })
  );
  return (await res.json()) as Record<string, any>;
}

async function herramienta(key: string, name: string, args: Record<string, unknown>) {
  const r = await rpc(key, "tools/call", { name, arguments: args });
  return r.result as { structuredContent: Record<string, any>; isError: boolean };
}

async function nombres(key: string) {
  return ((await rpc(key, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);
}

beforeAll(async () => {
  A = await crearOrganizacion("Acciones A");
  u.owner = await persona(A.id, "owner", "Dueña");
  u.ana = await persona(A.id, "asesor", "Ana Pérez");
  u.beto = await persona(A.id, "asesor", "Beto Ruiz");
  const deAna = await chat(A.id, u.ana, new Date());
  chats.deAna = deAna.conversationId;
  contactos.deAna = deAna.contactId;
  chats.deBeto = (await chat(A.id, u.beto, new Date())).conversationId;
  chats.cerrado = (await chat(A.id, u.ana, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))).conversationId;
  await sys().insert(schema.contactTag).values([
    { id: newId("contactTag"), organizationId: A.id, name: "VIP" },
    { id: newId("contactTag"), organizationId: A.id, name: "Frío" },
  ]);
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: A.id, conectorIa: true, trabajo: true })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { conectorIa: true, trabajo: true } });
  forgetOrgModules(A.id);
  await ajustes(2);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      metaCalls.push(String(input));
      return Response.json({ messages: [{ id: `wamid.${Math.random().toString(36).slice(2)}` }] });
    })
  );
});

beforeEach(() => {
  metaCalls.length = 0;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await borrarOrganizaciones([A.id]);
  for (const id of Object.values(u)) await sys().delete(schema.user).where(eq(schema.user.id, id));
});

describe("047 PR 4 — acciones de la IA conectada", () => {
  it("con solo lectura no aparecen las acciones; con escritura sí, y asignar solo para quien puede", async () => {
    expect(await nombres(await llave(u.ana, "asesor", ["read"]))).not.toContain("send_message");
    const ana = await nombres(await llave(u.ana, "asesor"));
    expect(ana).toEqual(expect.arrayContaining(["send_message", "tag_chat", "move_stage", "add_note", "create_task"]));
    expect(ana).not.toContain("assign_chat");
    expect(ana).not.toContain("list_people");
    const owner = await nombres(await llave(u.owner, "owner"));
    expect(owner).toEqual(expect.arrayContaining(["assign_chat", "list_people"]));
    // Lo que nunca existe.
    for (const n of ["export_contacts", "send_campaign", "delete_chat", "update_settings"]) {
      expect(owner).not.toContain(n);
    }
  });

  it("envía como Ana, por Meta, con la marca «Enviado por IA»; respeta el tope diario", async () => {
    const key = await llave(u.ana, "asesor");
    const r = await herramienta(key, "send_message", { conversation_id: chats.deAna, text: "Hola, te comparto el precio" });
    expect(r.isError).toBe(false);
    expect(metaCalls.some((c) => c.includes("/messages"))).toBe(true);
    const [m] = await sys().select().from(schema.message).where(eq(schema.message.id, r.structuredContent.message_id));
    expect(m).toMatchObject({ direction: "out", origin: "operator", aiGenerated: false, text: "Hola, te comparto el precio" });
    expect(m!.aiConnectionId).toMatch(/^aic_/);

    expect((await herramienta(key, "send_message", { conversation_id: chats.deAna, text: "segundo" })).isError).toBe(false);
    const tope = await herramienta(key, "send_message", { conversation_id: chats.deAna, text: "tercero" });
    expect(tope.isError).toBe(true);
    expect(tope.structuredContent.error).toContain("tope de 2");
    const log = await sys()
      .select()
      .from(schema.aiActionLog)
      .where(and(eq(schema.aiActionLog.organizationId, A.id), eq(schema.aiActionLog.tool, "send_message")));
    expect(log.map((l) => l.outcome).sort()).toEqual(["limited", "ok", "ok"]);
    expect(JSON.stringify(log)).not.toContain("precio");
  });

  it("firma con su nombre («Joe») o «Asistente»; renombrar no cambia lo ya enviado", async () => {
    await ajustes(100);
    const made = await runWithOrganization(A.id, () =>
      createPersonalKey(sessionContext(u.ana, A.id, "asesor"), { name: "Claude", scopes: ["read", "write"], assistantName: "  Joe  " })
    );
    const joe = await herramienta(made!.key, "send_message", { conversation_id: chats.deAna, text: "de Joe" });
    const [m1] = await sys().select().from(schema.message).where(eq(schema.message.id, joe.structuredContent.message_id));
    expect(m1!.aiSenderName).toBe("Joe");
    const { serializeMessage } = await import("@/server/inbox/ingest");
    expect(serializeMessage(m1!)).toMatchObject({ viaAiConnector: true, aiSenderName: "Joe" });

    const ana = sessionContext(u.ana, A.id, "asesor");
    expect(await runWithOrganization(A.id, () => renameAssistant(sessionContext(u.beto, A.id, "asesor"), made!.connection.id, "Robo"))).toBe(false);
    expect(await runWithOrganization(A.id, () => renameAssistant(ana, made!.connection.id, "   "))).toBe(true);
    const sinNombre = await herramienta(made!.key, "send_message", { conversation_id: chats.deAna, text: "sin nombre" });
    const [m2] = await sys().select().from(schema.message).where(eq(schema.message.id, sinNombre.structuredContent.message_id));
    expect(m2!.aiSenderName).toBeNull();
    const [antes] = await sys().select().from(schema.message).where(eq(schema.message.id, m1!.id));
    expect(antes!.aiSenderName).toBe("Joe");
    await ajustes(2);
  });

  it("el tope cuenta aunque la IA mande dos a la vez", async () => {
    const key = await llave(u.beto, "asesor");
    const rs = await Promise.all(
      [1, 2, 3].map((i) => herramienta(key, "send_message", { conversation_id: chats.deBeto, text: `simultáneo ${i}` }))
    );
    expect(rs.filter((r) => !r.isError)).toHaveLength(2);
  });

  it("con tope 0 la IA solo lee; fuera de la ventana de 24 h no envía; chat ajeno no existe", async () => {
    await ajustes(100);
    const key = await llave(u.ana, "asesor");
    const cerrado = await herramienta(key, "send_message", { conversation_id: chats.cerrado, text: "hola" });
    expect(cerrado.isError).toBe(true);
    const ajeno = await herramienta(key, "send_message", { conversation_id: chats.deBeto, text: "hola" });
    expect(ajeno.structuredContent.error).toContain("No existe o no tienes acceso");
    await ajustes(0);
    const apagado = await herramienta(key, "send_message", { conversation_id: chats.deAna, text: "hola" });
    expect(apagado.structuredContent.error).toContain("solo puede leer");
    expect(metaCalls.filter((c) => c.includes("/messages"))).toHaveLength(0);
    await ajustes(100);
  });

  it("etiqueta por nombre sin crear etiquetas; mueve de etapa y pide motivo al perder", async () => {
    const key = await llave(u.ana, "asesor");
    const mal = await herramienta(key, "tag_chat", { conversation_id: chats.deAna, add: ["Inventada"] });
    expect(mal.structuredContent.error).toContain("No existen estas etiquetas: Inventada");
    expect((await herramienta(key, "tag_chat", { conversation_id: chats.deAna, add: ["vip", "Frío"] })).structuredContent.tags.sort()).toEqual(
      ["Frío", "VIP"]
    );
    expect((await herramienta(key, "tag_chat", { conversation_id: chats.deAna, remove: ["Frío"] })).structuredContent.tags).toEqual(["VIP"]);

    expect((await herramienta(key, "move_stage", { conversation_id: chats.deAna, stage: "Etapa 1" })).structuredContent).toMatchObject({
      ok: true,
      from: "Etapa 0",
      to: "Etapa 1",
    });
    const sinMotivo = await herramienta(key, "move_stage", { conversation_id: chats.deAna, stage: "Etapa 3" });
    expect(sinMotivo.structuredContent.error).toContain("hace falta loss_reason");
    const perdido = await herramienta(key, "move_stage", { conversation_id: chats.deAna, stage: "Etapa 3", loss_reason: "otro" });
    expect(perdido.isError).toBe(false);
    expect((await herramienta(key, "move_stage", { conversation_id: chats.deBeto, stage: "Etapa 1" })).isError).toBe(true);
  });

  it("nota a nombre de Ana y tarea ligada al chat", async () => {
    const key = await llave(u.ana, "asesor");
    expect((await herramienta(key, "add_note", { conversation_id: chats.deAna, text: "Pidió factura" })).isError).toBe(false);
    const [nota] = await sys()
      .select()
      .from(schema.contactActivityEvent)
      .where(and(eq(schema.contactActivityEvent.contactId, contactos.deAna), eq(schema.contactActivityEvent.kind, "note_added")));
    expect(nota).toMatchObject({ actorUserId: u.ana, source: "usuario" });
    const t = await herramienta(key, "create_task", {
      title: "Mandar factura",
      due_at: "2026-11-03T10:00:00-06:00",
      conversation_id: chats.deAna,
    });
    const [task] = await sys().select().from(schema.workTask).where(eq(schema.workTask.id, t.structuredContent.task_id));
    expect(task).toMatchObject({ assigneeUserId: u.ana, createdBy: u.ana, conversationId: chats.deAna });
    expect((await herramienta(key, "create_task", { title: "x", conversation_id: chats.deBeto })).isError).toBe(true);
  });

  it("el Propietario asigna por nombre; un nombre que no existe no asigna a nadie", async () => {
    const key = await llave(u.owner, "owner");
    expect((await herramienta(key, "assign_chat", { conversation_id: chats.deAna, to: "Nadie" })).isError).toBe(true);
    expect((await herramienta(key, "assign_chat", { conversation_id: chats.deAna, to: "beto ruiz" })).structuredContent).toMatchObject({
      ok: true,
      assigned_to: "Beto Ruiz",
    });
    const [c] = await sys().select().from(schema.contact).where(eq(schema.contact.id, contactos.deAna));
    expect(c!.assignedUserId).toBe(u.beto);
    // Ana ya no lo ve: su IA tampoco.
    const ana = await llave(u.ana, "asesor");
    expect((await herramienta(ana, "add_note", { conversation_id: chats.deAna, text: "x" })).isError).toBe(true);
  });
});
