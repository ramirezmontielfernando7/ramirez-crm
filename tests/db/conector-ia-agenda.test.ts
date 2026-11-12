/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON-RPC sin tipar en la prueba */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sessionContext } from "@/lib/auth/session";
import { runWithOrganization } from "@/lib/request-context";
import { createPersonalKey } from "@/server/ai-connector/keys";
import { saveConnectorSettings } from "@/server/ai-connector/settings";
import { forgetOrgModules } from "@/server/modules/store";
import { POST } from "@/app/api/mcp/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

const auth = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  requireSession: async () => auth.session,
}));

/**
 * 047 — La Agenda por la IA conectada: ver citas y horarios libres, agendar,
 * reprogramar, cancelar y marcar; el asesor solo las citas de SUS clientes
 * y, sin el módulo Agenda de la organización, las herramientas no existen.
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
  A = await crearOrganizacion("Agenda IA");
  u.owner = await persona(A.id, "owner", "Dueña");
  u.ana = await persona(A.id, "asesor", "Ana Pérez");
  u.beto = await persona(A.id, "asesor", "Beto Ruiz");
  Object.assign(deAna, await chat(A.id, u.ana));
  Object.assign(deBeto, await chat(A.id, u.beto));
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: A.id, conectorIa: true, agenda: true })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { conectorIa: true, agenda: true } });
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

describe("047 — Agenda por la IA conectada", () => {
  it("agenda, reprograma, marca y cancela; el asesor no toca citas ajenas", async () => {
    const free = await herramienta(k.ana, "find_free_slots", { limit: 5 });
    expect(free.isError).toBe(false);
    const slots = free.structuredContent.slots as { start_utc: string }[];
    expect(slots.length).toBeGreaterThan(2);

    const booked = await herramienta(k.ana, "book_appointment", {
      conversation_id: deAna.conversationId,
      start_utc: slots[0]!.start_utc,
      notes: "Primera visita",
    });
    expect(booked.isError).toBe(false);
    const bookingId = booked.structuredContent.booking_id as string;
    const [row] = await sys().select().from(schema.booking).where(eq(schema.booking.id, bookingId));
    expect(row?.contactId).toBe(deAna.contactId);
    expect(row?.source).toBe("manual");

    // El mismo horario ya no está libre: alternativas, sin doble cita.
    const twice = await herramienta(k.owner, "book_appointment", { contact_id: deBeto.contactId, start_utc: slots[0]!.start_utc });
    expect(twice.isError).toBe(true);

    // Un cliente ajeno: ni agendar ni ver su cita.
    expect((await herramienta(k.ana, "book_appointment", { contact_id: deBeto.contactId, start_utc: slots[1]!.start_utc })).isError).toBe(true);
    const deBetoCita = await herramienta(k.owner, "book_appointment", { contact_id: deBeto.contactId, start_utc: slots[2]!.start_utc });
    expect(deBetoCita.isError).toBe(false);
    const ajena = deBetoCita.structuredContent.booking_id as string;

    const deAnaVe = await herramienta(k.ana, "list_bookings", { to: slots[2]!.start_utc.slice(0, 10) });
    const vistas = deAnaVe.structuredContent.bookings.map((b: any) => b.booking_id);
    expect(vistas).toContain(bookingId);
    expect(vistas).not.toContain(ajena);
    const todas = await herramienta(k.owner, "list_bookings", {});
    expect(todas.structuredContent.bookings.map((b: any) => b.booking_id)).toEqual(expect.arrayContaining([bookingId, ajena]));
    expect((await herramienta(k.ana, "update_appointment", { booking_id: ajena, action: "cancel" })).isError).toBe(true);

    const moved = await herramienta(k.ana, "update_appointment", { booking_id: bookingId, action: "reschedule", start_utc: slots[1]!.start_utc });
    expect(moved.isError).toBe(false);
    expect((await herramienta(k.ana, "update_appointment", { booking_id: bookingId, action: "done" })).isError).toBe(false);
    expect((await herramienta(k.ana, "update_appointment", { booking_id: bookingId, action: "cancel" })).isError).toBe(false);
    const [after] = await sys().select().from(schema.booking).where(eq(schema.booking.id, bookingId));
    expect(after?.status).toBe("cancelada");
    expect(new Date(after!.scheduledAt).toISOString()).toBe(new Date(slots[1]!.start_utc).toISOString());
  });

  it("sin el módulo Agenda las herramientas no aparecen", async () => {
    const names = async () => ((await rpc(k.owner, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);
    expect(await names()).toContain("book_appointment");
    await sys().update(schema.organizationModule).set({ agenda: false }).where(eq(schema.organizationModule.organizationId, A.id));
    forgetOrgModules(A.id);
    try {
      const list = await names();
      expect(list).not.toContain("list_bookings");
      expect(list).not.toContain("book_appointment");
      expect((await herramienta(k.owner, "list_bookings", {})).isError).toBe(true);
    } finally {
      await sys().update(schema.organizationModule).set({ agenda: true }).where(eq(schema.organizationModule.organizationId, A.id));
      forgetOrgModules(A.id);
    }
  });
});
