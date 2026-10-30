/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON-RPC sin tipar en la prueba */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sessionContext } from "@/lib/auth/session";
import { runWithOrganization } from "@/lib/request-context";
import { createPersonalKey } from "@/server/ai-connector/keys";
import { saveConnectorSettings } from "@/server/ai-connector/settings";
import { setAdvisorNewChatsBlocked } from "@/server/messaging-settings";
import { forgetOrgModules } from "@/server/modules/store";
import { POST } from "@/app/api/mcp/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 047 — Abrir chats y escribir primero desde la IA conectada: abre el chat
 * de un contacto recién importado (o de un número nuevo), le manda una
 * plantilla solo con consentimiento y archiva, marca leído o pausa la IA.
 * Las mismas puertas que la Bandeja: el asesor solo abre lo suyo y respeta
 * «Chats nuevos de los asesores».
 */

type Role = "owner" | "coordinador" | "asesor";
const sys = () => getSystemDb();

let A: Awaited<ReturnType<typeof crearOrganizacion>>;
const u = { owner: "", ana: "", beto: "" };
const k = { owner: "", ana: "" };
const metaCalls: string[] = [];

async function persona(orgId: string, role: Role, name: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@abrir.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role });
  return id;
}

/** Un contacto SIN chat, como queda tras importarlo. */
async function contacto(asignadoA: string | null, consent: "opt_in" | "desconocido" | "opt_out" = "opt_in") {
  const id = newId("contact");
  const tel = `52155${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  await sys()
    .insert(schema.contact)
    .values({ id, organizationId: A.id, waIdentity: tel, phone: tel, name: `Importado ${tel.slice(-4)}`, assignedUserId: asignadoA, waConsent: consent });
  const [stage] = await sys()
    .select()
    .from(schema.pipelineStage)
    .where(and(eq(schema.pipelineStage.organizationId, A.id), eq(schema.pipelineStage.position, 0)));
  await sys().insert(schema.lead).values({ id: newId("lead"), organizationId: A.id, contactId: id, stageId: stage!.id });
  return id;
}

async function chatsDe(contactId: string) {
  return sys().select().from(schema.conversation).where(eq(schema.conversation.contactId, contactId));
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
  A = await crearOrganizacion("Abrir chat A");
  u.owner = await persona(A.id, "owner", "Dueña");
  u.ana = await persona(A.id, "asesor", "Ana Pérez");
  u.beto = await persona(A.id, "asesor", "Beto Ruiz");
  await sys().insert(schema.template).values({
    id: newId("template"),
    organizationId: A.id,
    name: "bienvenida",
    language: "es_MX",
    category: "MARKETING",
    body: "Hola {{1}}, gracias por tu interés",
    status: "approved",
  });
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: A.id, conectorIa: true })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { conectorIa: true } });
  forgetOrgModules(A.id);
  await runWithOrganization(A.id, () =>
    saveConnectorSettings(A.id, u.owner, { enabled: true, allowedRoles: ["coordinador", "asesor"], dailyMessageLimit: 50 })
  );
  k.owner = await llave(u.owner, "owner");
  k.ana = await llave(u.ana, "asesor");
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

describe("047 — abrir chat y escribir primero", () => {
  it("las herramientas aparecen para cualquier rol con escritura", async () => {
    const tools = ((await rpc(k.ana, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["open_chat", "list_chat_templates", "send_template", "update_chat"]));
  });

  it("abre el chat de un contacto importado, sin duplicarlo, y solo si la persona lo ve", async () => {
    const mio = await contacto(u.ana);
    const r = await herramienta(k.ana, "open_chat", { contact_id: mio });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.already_existed).toBe(false);
    expect(r.structuredContent.window_open).toBe(false);
    const otra = await herramienta(k.ana, "open_chat", { contact_id: mio });
    expect(otra.structuredContent.conversation_id).toBe(r.structuredContent.conversation_id);
    expect(await chatsDe(mio)).toHaveLength(1);
    // Ya aparece en su Bandeja.
    const lista = await herramienta(k.ana, "read_chat", { conversation_id: r.structuredContent.conversation_id });
    expect(lista.isError).toBe(false);

    const deBeto = await contacto(u.beto);
    expect((await herramienta(k.ana, "open_chat", { contact_id: deBeto })).isError).toBe(true);
    expect(await chatsDe(deBeto)).toHaveLength(0);
  });

  it("con un teléfono nuevo registra el contacto con su nombre y abre el chat", async () => {
    const r = await herramienta(k.owner, "open_chat", { phone: "5215598765432", name: "Rosa Díaz" });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.contact_created).toBe(true);
    const [c] = await sys().select().from(schema.contact).where(eq(schema.contact.id, r.structuredContent.contact.id));
    expect(c?.name).toBe("Rosa Díaz");
    expect(await chatsDe(c!.id)).toHaveLength(1);
  });

  it("respeta «Chats nuevos de los asesores»", async () => {
    await runWithOrganization(A.id, () => setAdvisorNewChatsBlocked(A.id, true, u.owner));
    try {
      const mio = await contacto(u.ana);
      const r = await herramienta(k.ana, "open_chat", { contact_id: mio });
      expect(r.isError).toBe(true);
      expect(await chatsDe(mio)).toHaveLength(0);
      // La dueña sí puede.
      expect((await herramienta(k.owner, "open_chat", { contact_id: mio })).isError).toBe(false);
    } finally {
      await runWithOrganization(A.id, () => setAdvisorNewChatsBlocked(A.id, false, u.owner));
    }
  });

  it("manda la plantilla solo con consentimiento, marcada como de la IA y contando para el tope", async () => {
    const plantillas = await herramienta(k.ana, "list_chat_templates");
    expect(plantillas.structuredContent.templates).toEqual([expect.objectContaining({ name: "bienvenida", variables: 1 })]);

    const conSi = await contacto(u.ana, "opt_in");
    const chat = (await herramienta(k.ana, "open_chat", { contact_id: conSi })).structuredContent.conversation_id;
    const falta = await herramienta(k.ana, "send_template", { conversation_id: chat, template: "bienvenida" });
    expect(falta.isError).toBe(true);
    const ok = await herramienta(k.ana, "send_template", { conversation_id: chat, template: "bienvenida", variables: ["Laura"] });
    expect(ok.isError).toBe(false);
    expect(ok.structuredContent.sent_today).toBe(1);
    expect(metaCalls).toHaveLength(1);
    const [m] = await sys().select().from(schema.message).where(eq(schema.message.conversationId, chat));
    expect(m?.type).toBe("template");
    expect(m?.aiConnectionId).toBeTruthy();

    const sinSaber = await contacto(u.ana, "desconocido");
    const chat2 = (await herramienta(k.ana, "open_chat", { contact_id: sinSaber })).structuredContent.conversation_id;
    expect((await herramienta(k.ana, "send_template", { conversation_id: chat2, template: "bienvenida", variables: ["X"] })).isError).toBe(true);

    const baja = await contacto(u.ana, "opt_out");
    const chat3 = (await herramienta(k.ana, "open_chat", { contact_id: baja })).structuredContent.conversation_id;
    expect((await herramienta(k.ana, "send_template", { conversation_id: chat3, template: "bienvenida", variables: ["X"] })).isError).toBe(true);
    expect(metaCalls).toHaveLength(1);
  });

  it("archiva, marca leído y pausa la IA de un chat", async () => {
    const mio = await contacto(u.ana);
    const chat = (await herramienta(k.ana, "open_chat", { contact_id: mio })).structuredContent.conversation_id;
    const r = await herramienta(k.ana, "update_chat", { conversation_id: chat, archived: true, ai_paused: true, mark_read: true });
    expect(r.isError).toBe(false);
    expect(r.structuredContent).toMatchObject({ archived: true, ai_paused: true, unread: 0 });
    const back = await herramienta(k.ana, "update_chat", { conversation_id: chat, archived: false, ai_paused: false });
    expect(back.structuredContent).toMatchObject({ archived: false, ai_paused: false });
  });
});
