import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { ingestInboundMessage, processEchoesValue } from "@/server/inbox/ingest";
import { listConversations } from "@/server/inbox/queries";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 034 — Bandeja: archivar y recuperar, eliminar (solo Propietario y
 * Coordinador, 403 para el resto, cascada de mensajes), que un entrante
 * desarchive, y que un chat nacido de un echo (mensaje enviado desde el
 * teléfono) llegue con etapa. Contra Postgres real, conectada como la app.
 */

type Role = "owner" | "coordinador" | "asesor";
const state = vi.hoisted(() => ({
  session: null as null | {
    userId: string;
    organizationId: string;
    role: string;
    grants: never[];
    access: { organizationId: string; userId: string; seesAll: boolean };
  },
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...real,
    requireSession: async () => {
      if (!state.session) throw new real.UnauthorizedError();
      return state.session;
    },
    getSessionOrNull: async () => state.session,
  };
});

function como(organizationId: string, userId: string, role: Role) {
  state.session = {
    userId,
    organizationId,
    role,
    grants: [],
    access: { organizationId, userId, seesAll: role !== "asesor" },
  };
}

type ApiBody = {
  conversation: { archivedAt: string | null };
  error: { code: string };
};
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function llamar(method: "GET" | "PATCH" | "DELETE", id: string, body?: unknown) {
  const route = id ? "conversations/[id]" : "conversations";
  const mod = (await import(`@/app/api/${route}/route`)) as Record<string, Handler>;
  const res = await mod[method]!(
    new Request(`http://localhost/api/conversations/${id}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
  const text = await res.text();
  const empty = {} as ApiBody;
  return { status: res.status, data: text ? (JSON.parse(text) as ApiBody) : empty };
}

const sys = () => getSystemDb();

async function persona(orgId: string, role: Role): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name: role, email: `${id}@bandeja.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role });
  return id;
}

async function chat(orgId: string, asignadoA: string | null = null) {
  const contactId = newId("contact");
  const tel = `52155${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  await sys().insert(schema.contact).values({
    id: contactId,
    organizationId: orgId,
    waIdentity: tel,
    phone: tel,
    name: `Cliente ${tel.slice(-4)}`,
    assignedUserId: asignadoA,
  });
  const conversationId = newId("conversation");
  await sys().insert(schema.conversation).values({ id: conversationId, organizationId: orgId, contactId });
  for (const text of ["hola", "¿precio?", "gracias"]) {
    await sys().insert(schema.message).values({
      id: newId("message"),
      organizationId: orgId,
      conversationId,
      direction: "in",
      type: "text",
      text,
      status: "delivered",
      waMessageId: `wamid.${newId("message")}`,
    });
  }
  return { contactId, conversationId, tel };
}

const filasDe = async (conversationId: string) =>
  sys().select().from(schema.conversation).where(eq(schema.conversation.id, conversationId));
const mensajesDe = async (conversationId: string) =>
  sys().select().from(schema.message).where(eq(schema.message.conversationId, conversationId));

let A: Awaited<ReturnType<typeof crearOrganizacion>>;
let B: Awaited<ReturnType<typeof crearOrganizacion>>;
const u = { owner: "", coord: "", ana: "", beto: "", ownerB: "" };

beforeAll(async () => {
  A = await crearOrganizacion("Bandeja A");
  B = await crearOrganizacion("Bandeja B");
  u.owner = await persona(A.id, "owner");
  u.coord = await persona(A.id, "coordinador");
  u.ana = await persona(A.id, "asesor");
  u.beto = await persona(A.id, "asesor");
  u.ownerB = await persona(B.id, "owner");
});

afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
});

describe("la lista trae lo que pintan las cápsulas", () => {
  it("etiquetas (ordenadas), lead y etapa, y si hay bot — en una sola consulta", async () => {
    const c = await chat(A.id);
    const etapa = (
      await sys().select().from(schema.pipelineStage).where(eq(schema.pipelineStage.organizationId, A.id))
    )[0]!;
    const leadId = newId("lead");
    await sys().insert(schema.lead).values({ id: leadId, organizationId: A.id, contactId: c.contactId, stageId: etapa.id, position: 0 });
    const zeta = newId("contactTag");
    const alfa = newId("contactTag");
    await sys().insert(schema.contactTag).values([
      { id: zeta, organizationId: A.id, name: "Zeta" },
      { id: alfa, organizationId: A.id, name: "Alumno", color: "azul" },
    ]);
    await sys().insert(schema.contactTagAssignment).values([
      { organizationId: A.id, contactId: c.contactId, tagId: zeta },
      { organizationId: A.id, contactId: c.contactId, tagId: alfa },
    ]);

    const lista = await runWithOrganization(A.id, () =>
      listConversations({ organizationId: A.id, userId: u.owner, seesAll: true })
    );
    const fila = lista.find((x) => x.id === c.conversationId)!;
    expect(fila.leadId).toBe(leadId);
    expect(fila.stageId).toBe(etapa.id);
    expect(fila.stageName).toBe(etapa.name);
    expect(fila.tags.map((t) => t.name)).toEqual(["Alumno", "Zeta"]);
    expect(fila.tags[0]).toMatchObject({ id: alfa, color: "azul" });
    // Sin etiquetas ni lead: arreglos y nulos, no undefined.
    const otro = await chat(A.id);
    const lista2 = await runWithOrganization(A.id, () =>
      listConversations({ organizationId: A.id, userId: u.owner, seesAll: true })
    );
    const sinNada = lista2.find((x) => x.id === otro.conversationId)!;
    expect(sinNada.tags).toEqual([]);
    expect(sinNada.leadId).toBeNull();

    // `crearOrganizacion` deja el agente apagado: sin bot (salvo cerebro externo).
    expect(fila.aiAvailable).toBe(false);
    await sys().update(schema.agentProfile).set({ enabled: true }).where(eq(schema.agentProfile.organizationId, A.id));
    const conBot = await runWithOrganization(A.id, () =>
      listConversations({ organizationId: A.id, userId: u.owner, seesAll: true })
    );
    expect(conBot.find((x) => x.id === c.conversationId)?.aiAvailable).toBe(true);
    await sys().update(schema.agentProfile).set({ enabled: false }).where(eq(schema.agentProfile.organizationId, A.id));
  });
});

describe("archivar y recuperar", () => {
  it("archivar oculta de la lista principal pero conserva la fila y los mensajes; recuperar la devuelve", async () => {
    const c = await chat(A.id);
    como(A.id, u.owner, "owner");

    const archivado = await llamar("PATCH", c.conversationId, { archived: true });
    expect(archivado.status).toBe(200);
    expect(archivado.data.conversation.archivedAt).not.toBeNull();

    // Sigue en la base de datos, con sus mensajes.
    expect((await filasDe(c.conversationId))[0]?.archivedAt).toBeInstanceOf(Date);
    expect(await mensajesDe(c.conversationId)).toHaveLength(3);

    // La lista la manda marcada: la Bandeja principal la oculta, «Archivados» la muestra.
    const lista = await runWithOrganization(A.id, () =>
      listConversations({ organizationId: A.id, userId: u.owner, seesAll: true })
    );
    const fila = lista.find((x) => x.id === c.conversationId);
    expect(fila?.archivedAt).not.toBeNull();

    const recuperado = await llamar("PATCH", c.conversationId, { archived: false });
    expect(recuperado.status).toBe(200);
    expect(recuperado.data.conversation.archivedAt).toBeNull();
    expect((await filasDe(c.conversationId))[0]?.archivedAt).toBeNull();
  });

  it("un asesor archiva SU chat, pero el de otro asesor es un 404 y no cambia", async () => {
    const suyo = await chat(A.id, u.ana);
    const ajeno = await chat(A.id, u.beto);
    como(A.id, u.ana, "asesor");

    expect((await llamar("PATCH", suyo.conversationId, { archived: true })).status).toBe(200);
    expect((await llamar("PATCH", ajeno.conversationId, { archived: true })).status).toBe(404);
    expect((await filasDe(ajeno.conversationId))[0]?.archivedAt).toBeNull();
  });

  it("un mensaje entrante desarchiva el chat", async () => {
    const c = await chat(A.id);
    como(A.id, u.owner, "owner");
    await llamar("PATCH", c.conversationId, { archived: true });
    expect((await filasDe(c.conversationId))[0]?.archivedAt).not.toBeNull();

    await ingestInboundMessage({
      organizationId: A.id,
      identity: { identity: c.tel, phone: c.tel, waUserId: null, profileName: null },
      waMessageId: `wamid.${newId("message")}`,
      type: "text",
      text: "¿sigue en pie?",
      timestamp: String(Math.floor(Date.now() / 1000)),
    });

    expect((await filasDe(c.conversationId))[0]?.archivedAt).toBeNull();
  });
});

describe("eliminar", () => {
  it("el Propietario y el Coordinador eliminan: se va el chat y TODOS sus mensajes; contacto y lead se quedan", async () => {
    for (const [userId, role] of [
      [u.owner, "owner"],
      [u.coord, "coordinador"],
    ] as const) {
      const c = await chat(A.id);
      const leadId = newId("lead");
      const etapa = (
        await sys().select().from(schema.pipelineStage).where(eq(schema.pipelineStage.organizationId, A.id))
      )[0]!;
      await sys().insert(schema.lead).values({
        id: leadId,
        organizationId: A.id,
        contactId: c.contactId,
        stageId: etapa.id,
        position: 0,
      });
      como(A.id, userId, role);

      const res = await llamar("DELETE", c.conversationId);
      expect(res.status).toBe(200);
      expect(await filasDe(c.conversationId)).toHaveLength(0);
      expect(await mensajesDe(c.conversationId)).toHaveLength(0);
      expect(
        await sys().select().from(schema.contact).where(eq(schema.contact.id, c.contactId))
      ).toHaveLength(1);
      expect(await sys().select().from(schema.lead).where(eq(schema.lead.id, leadId))).toHaveLength(1);
    }
  });

  it("un ASESOR recibe 403 (aunque sea SU chat) y no se borra nada", async () => {
    const c = await chat(A.id, u.ana);
    como(A.id, u.ana, "asesor");

    const res = await llamar("DELETE", c.conversationId);
    expect(res.status).toBe(403);
    expect(res.data.error.code).toBe("forbidden");
    expect(await filasDe(c.conversationId)).toHaveLength(1);
    expect(await mensajesDe(c.conversationId)).toHaveLength(3);
  });

  it("eliminar un chat que no existe, o de otra organización, es un 404", async () => {
    const deB = await chat(B.id);
    como(A.id, u.owner, "owner");

    expect((await llamar("DELETE", "cv_no_existe")).status).toBe(404);
    expect((await llamar("DELETE", deB.conversationId)).status).toBe(404);
    expect(await filasDe(deB.conversationId)).toHaveLength(1);
  });

  it("sin sesión es un 401", async () => {
    const c = await chat(A.id);
    state.session = null;
    expect((await llamar("DELETE", c.conversationId)).status).toBe(401);
    expect(await filasDe(c.conversationId)).toHaveLength(1);
  });
});

describe("chats que nacen de un echo (mensaje enviado desde el teléfono)", () => {
  // Ya normalizado (521… → 52…), que es la llave `wa_identity` del contacto.
  const telefonoNormalizado = () =>
    `5255${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;

  const echo = (telefono: string, id: string) => ({
    metadata: { phone_number_id: A.phoneNumberId },
    message_echoes: [
      {
        id,
        to: telefono,
        from: "5215500000000",
        type: "text",
        timestamp: String(Math.floor(Date.now() / 1000)),
        text: { body: "Hola, te escribo desde mi teléfono" },
      },
    ],
  });
  // Lo que hace el webhook de verdad (tipos de Meta sin cerrar).
  const procesar = (v: ReturnType<typeof echo>) =>
    processEchoesValue(v as unknown as Parameters<typeof processEchoesValue>[0]);

  it("nace con la etapa inicial de la organización (la misma del entrante)", async () => {
    const tel = telefonoNormalizado();
    await procesar(echo(tel, `wamid.${newId("message")}`));

    const contacto = (
      await sys().select().from(schema.contact).where(and(eq(schema.contact.organizationId, A.id), eq(schema.contact.waIdentity, tel)))
    )[0]!;
    expect(contacto).toBeDefined();
    const leads = await sys().select().from(schema.lead).where(eq(schema.lead.contactId, contacto.id));
    expect(leads).toHaveLength(1);

    const primera = (
      await sys()
        .select()
        .from(schema.pipelineStage)
        .where(and(eq(schema.pipelineStage.organizationId, A.id), eq(schema.pipelineStage.kind, "open")))
        .orderBy(schema.pipelineStage.position)
    )[0]!;
    expect(leads[0]?.stageId).toBe(primera.id);

    // Y la Bandeja la lista CON etapa.
    const lista = await runWithOrganization(A.id, () =>
      listConversations({ organizationId: A.id, userId: u.owner, seesAll: true })
    );
    expect(lista.find((c) => c.contact.id === contacto.id)?.stageName).toBe(primera.name);
  });

  it("es idempotente: repetir el echo no duplica el lead, y un lead existente no se mueve", async () => {
    const tel = telefonoNormalizado();
    const id = `wamid.${newId("message")}`;
    await procesar(echo(tel, id));
    await procesar(echo(tel, id));

    const contacto = (
      await sys().select().from(schema.contact).where(and(eq(schema.contact.organizationId, A.id), eq(schema.contact.waIdentity, tel)))
    )[0]!;
    const [lead] = await sys().select().from(schema.lead).where(eq(schema.lead.contactId, contacto.id));
    expect(lead).toBeDefined();

    // El dueño la movió a otra etapa: un echo posterior NO la regresa.
    const otra = (
      await sys()
        .select()
        .from(schema.pipelineStage)
        .where(and(eq(schema.pipelineStage.organizationId, A.id), eq(schema.pipelineStage.kind, "won")))
    )[0]!;
    await sys().update(schema.lead).set({ stageId: otra.id }).where(eq(schema.lead.id, lead!.id));
    await procesar(echo(tel, `wamid.${newId("message")}`));
    const leads = await sys().select().from(schema.lead).where(eq(schema.lead.contactId, contacto.id));
    expect(leads).toHaveLength(1);
    expect(leads[0]?.stageId).toBe(otra.id);
  });
});
