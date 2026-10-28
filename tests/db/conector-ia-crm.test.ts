/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON-RPC sin tipar en la prueba */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sessionContext } from "@/lib/auth/session";
import { runWithOrganization } from "@/lib/request-context";
import { createPersonalKey } from "@/server/ai-connector/keys";
import { saveConnectorSettings } from "@/server/ai-connector/settings";
import { forgetOrgModules } from "@/server/modules/store";
import { POST } from "@/app/api/mcp/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 047 — Ficha del contacto, embudo, tareas y notas de trabajo por la IA
 * conectada: lo mismo que la pantalla deja a cada rol, con la misma
 * visibilidad (el asesor solo lo suyo) y sin borrar nada.
 */

type Role = "owner" | "coordinador" | "asesor";
const sys = () => getSystemDb();

let A: Awaited<ReturnType<typeof crearOrganizacion>>;
const u = { owner: "", ana: "", beto: "" };
const k = { owner: "", ana: "" };
const deAna = { conversationId: "", contactId: "" };
const deBeto = { conversationId: "", contactId: "" };

async function persona(orgId: string, role: Role, name: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@crm.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role });
  return id;
}

async function chat(orgId: string, asignadoA: string) {
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
    .values({ id: conversationId, organizationId: orgId, contactId, lastMessageAt: new Date(), lastInboundAt: new Date() });
  return { conversationId, contactId };
}

async function llave(userId: string, role: Role) {
  const made = await runWithOrganization(A.id, () =>
    createPersonalKey(sessionContext(userId, A.id, role), { name: "Claude de prueba", scopes: ["read", "write"] })
  );
  if (!made) throw new Error("no se pudo crear la llave");
  return made.key;
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

async function herramienta(key: string, name: string, args: Record<string, unknown> = {}) {
  const r = await rpc(key, "tools/call", { name, arguments: args });
  return (r.result ?? { isError: true, structuredContent: r.error }) as { structuredContent: Record<string, any>; isError: boolean };
}

beforeAll(async () => {
  A = await crearOrganizacion("CRM A");
  u.owner = await persona(A.id, "owner", "Dueña");
  u.ana = await persona(A.id, "asesor", "Ana Pérez");
  u.beto = await persona(A.id, "asesor", "Beto Ruiz");
  Object.assign(deAna, await chat(A.id, u.ana));
  Object.assign(deBeto, await chat(A.id, u.beto));
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: A.id, conectorIa: true, trabajo: true })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { conectorIa: true, trabajo: true } });
  forgetOrgModules(A.id);
  await runWithOrganization(A.id, () =>
    saveConnectorSettings(A.id, u.owner, { enabled: true, allowedRoles: ["coordinador", "asesor"], dailyMessageLimit: 50 })
  );
  k.owner = await llave(u.owner, "owner");
  k.ana = await llave(u.ana, "asesor");
});

afterAll(async () => {
  await borrarOrganizaciones([A.id]);
  for (const id of Object.values(u)) await sys().delete(schema.user).where(eq(schema.user.id, id));
});

describe("047 — ficha, embudo, tareas y notas", () => {
  it("el asesor ve y corrige la ficha de SUS contactos, no la de otro", async () => {
    const r = await herramienta(k.ana, "read_contact", { conversation_id: deAna.conversationId });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.contact_id).toBe(deAna.contactId);
    expect(r.structuredContent.stage).toBeTruthy();
    expect((await herramienta(k.ana, "read_contact", { contact_id: deBeto.contactId })).isError).toBe(true);

    const upd = await herramienta(k.ana, "update_contact", {
      contact_id: deAna.contactId,
      name: "Laura Gómez",
      ficha: { carrera: "Derecho", turno: "matutino" },
    });
    expect(upd.isError).toBe(false);
    const [c] = await sys().select().from(schema.contact).where(eq(schema.contact.id, deAna.contactId));
    expect(c?.name).toBe("Laura Gómez");
    expect(c?.nameSource).toBe("manual");
    expect(c?.ficha).toMatchObject({ carrera: "Derecho", turno: "matutino" });
    // El consentimiento no es un campo de esta herramienta.
    expect((await herramienta(k.ana, "update_contact", { contact_id: deAna.contactId, waConsent: "opt_out" })).isError).toBe(true);

    const otro = await herramienta(k.ana, "update_contact", { contact_id: deBeto.contactId, name: "Hackeado" });
    expect(otro.isError).toBe(true);
    const [b] = await sys().select().from(schema.contact).where(eq(schema.contact.id, deBeto.contactId));
    expect(b?.name).not.toBe("Hackeado");
  });

  it("el embudo: el asesor solo sus leads; monto y prioridad", async () => {
    const ana = await herramienta(k.ana, "list_pipeline");
    expect(ana.structuredContent.leads.map((l: any) => l.contact.id)).toEqual([deAna.contactId]);
    const owner = await herramienta(k.owner, "list_pipeline");
    expect(owner.structuredContent.leads).toHaveLength(2);
    expect(owner.structuredContent.stages[0].leads).toBe(2);
    expect((await herramienta(k.owner, "list_pipeline", { stage: "No existe" })).isError).toBe(true);

    const upd = await herramienta(k.ana, "update_lead", { conversation_id: deAna.conversationId, amount: 1500.5, priority: "alta" });
    expect(upd.isError).toBe(false);
    const [lead] = await sys().select().from(schema.lead).where(eq(schema.lead.contactId, deAna.contactId));
    expect(lead?.amountCents).toBe(150050);
    expect(lead?.priority).toBe("alta");
    expect(lead?.currency).toBeTruthy();
    expect((await herramienta(k.ana, "update_lead", { conversation_id: deBeto.conversationId, amount: 1 })).isError).toBe(true);
  });

  it("tareas: edita y completa las suyas", async () => {
    const t = await herramienta(k.ana, "create_task", { title: "Llamar a Laura", conversation_id: deAna.conversationId });
    const id = t.structuredContent.task_id;
    const done = await herramienta(k.ana, "update_task", { task_id: id, title: "Llamar a Laura (urgente)", done: true });
    expect(done.isError).toBe(false);
    expect(done.structuredContent.done).toBe(true);
    const [row] = await sys().select().from(schema.workTask).where(eq(schema.workTask.id, id));
    expect(row?.title).toBe("Llamar a Laura (urgente)");
    expect(row?.doneBy).toBe(u.ana);
    expect((await herramienta(k.ana, "update_task", { task_id: "wt_noexiste", done: true })).isError).toBe(true);
  });

  it("notas de trabajo: crea, lista y archiva; la de otro asesor no la ve", async () => {
    const own = await herramienta(k.ana, "create_work_note", { title: "Ideas", body: "Ofrecer beca" });
    expect(own.isError).toBe(false);
    const linked = await herramienta(k.ana, "create_work_note", { body: "Prefiere WhatsApp", conversation_id: deAna.conversationId });
    expect(linked.isError).toBe(false);

    const mine = await herramienta(k.ana, "list_work_notes");
    expect(mine.structuredContent.notes.map((n: any) => n.id)).toEqual(
      expect.arrayContaining([own.structuredContent.note_id, linked.structuredContent.note_id])
    );
    const ofContact = await herramienta(k.owner, "list_work_notes", { conversation_id: deAna.conversationId });
    expect(ofContact.structuredContent.notes.map((n: any) => n.id)).toEqual([linked.structuredContent.note_id]);

    const arch = await herramienta(k.ana, "update_work_note", { note_id: own.structuredContent.note_id, archived: true });
    expect(arch.isError).toBe(false);
    const archived = await herramienta(k.ana, "list_work_notes", { archived: true });
    expect(archived.structuredContent.notes.map((n: any) => n.id)).toContain(own.structuredContent.note_id);

    // La nota sin ligar de Ana es solo suya: ni la Dueña la toca.
    expect((await herramienta(k.owner, "update_work_note", { note_id: own.structuredContent.note_id, body: "x" })).isError).toBe(true);
  });
});
