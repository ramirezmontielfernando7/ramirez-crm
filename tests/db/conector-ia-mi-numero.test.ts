/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON-RPC sin tipar en la prueba */
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sessionContext } from "@/lib/auth/session";
import type { DeviceMessage } from "@/lib/direct-inbound";
import { runWithOrganization } from "@/lib/request-context";
import { createPersonalKey } from "@/server/ai-connector/keys";
import { saveConnectorSettings } from "@/server/ai-connector/settings";
import { sealForStorage } from "@/server/credentials";
import { insertServer } from "@/server/credentials/direct";
import { saveDirectLimits } from "@/server/direct-connection/limits";
import { resetDirectQueueForTests } from "@/server/direct-connection/send";
import { listMyChats } from "@/server/mi-numero/chats";
import { ingestNumberMessages } from "@/server/mi-numero/inbound";
import { myNumber, updateMyNumber } from "@/server/mi-numero/numbers";
import { forgetOrgModules } from "@/server/modules";
import { updateOrgModules } from "@/server/modules/store";
import { POST } from "@/app/api/mcp/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 047 PR 4b — El quinto interruptor de «Mi número» contra Postgres real:
 * «Mi IA puede ver y contestar mis chats de cliente».
 *
 * - Apagado (de fábrica): la IA no ve ningún chat del número.
 * - Encendido: solo los chats marcados «Es cliente» del número PROPIO; los
 *   privados y los números de otros no existen para la IA.
 * - Contestar sale por el dispositivo del número, con la marca y el nombre
 *   de la IA, y cuenta en el tope diario.
 */

const sys = () => getSystemDb();
const BASE = "http://localhost:47813";
const LLAVE_ANA = "llave-ana-ia-0123456789";

const calls: { url: string; body: Record<string, unknown> }[] = [];
function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  calls.push({ url, body });
  if (url.includes("/chat/sendPresence/")) return Promise.resolve(Response.json({}));
  return Promise.resolve(Response.json({ key: { id: `EVO${calls.length}X${Date.now()}` }, status: "PENDING" }, { status: 201 }));
}
const sends = () => calls.filter((c) => !c.url.includes("sendPresence"));

let seq = 0;
function msg(phone: string, text: string): DeviceMessage {
  const keyId = `IA${++seq}${Date.now()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    keyId,
    fromMe: false,
    phone,
    lid: null,
    pushName: "Cliente",
    timestamp: ts,
    message: { type: "text", text: { body: text }, id: `direct.${keyId}`, timestamp: ts, from: phone } as DeviceMessage["message"],
  };
}

async function persona(orgId: string, role: string, name: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@ia-numero.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role });
  return id;
}

let rpcSeq = 0;
async function herramienta(key: string, name: string, args: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcSeq, method: "tools/call", params: { name, arguments: args } }),
    })
  );
  return ((await res.json()) as Record<string, any>).result as { structuredContent: Record<string, any>; isError: boolean };
}

describe("conector de IA — los chats de cliente de «Mi número» (PR 4b)", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let owner: string;
  let ana: string;
  let beto: string;
  let numAna: string;
  let serverId: string;
  let deCliente: string;
  let privado: string;
  let llaveAna: string;
  let llaveBeto: string;
  let conexionAna: string;

  const interruptor = (set: Partial<typeof schema.directNumber.$inferInsert>) =>
    sys().update(schema.directNumber).set(set).where(eq(schema.directNumber.id, numAna));

  beforeAll(async () => {
    A = await crearOrganizacion("IA Mi número A");
    owner = await persona(A.id, "owner", "Dueña");
    ana = await persona(A.id, "asesor", "Ana");
    beto = await persona(A.id, "asesor", "Beto");
    await updateOrgModules(A.id, { conexionDirecta: true, miNumero: true, miNumeroMax: 3, conectorIa: true }, "prueba");
    forgetOrgModules(A.id);
    await runWithOrganization(A.id, () =>
      saveConnectorSettings(A.id, owner, { enabled: true, allowedRoles: ["asesor"], dailyMessageLimit: 2 })
    );
    numAna = newId("directNumber");
    await sys().insert(schema.directNumber).values({ id: numAna, organizationId: A.id, userId: ana, noticeAcceptedAt: new Date() });
    const server = await insertServer(
      { name: `IA ${Math.random().toString(36).slice(2, 6)}`, baseUrl: `${BASE}/${Math.random().toString(36).slice(2, 8)}`, apiKey: "llave-maestra-0123456789" },
      null
    );
    serverId = server.id;
    const sealed = sealForStorage(LLAVE_ANA);
    conexionAna = newId("directConnection");
    await sys().insert(schema.directConnection).values({
      id: conexionAna,
      organizationId: A.id,
      directNumberId: numAna,
      serverId,
      instanceName: "inst-ana-ia",
      instanceKeyCipher: sealed.cipher,
      instanceKeyIv: sealed.iv,
      instanceKeyTag: sealed.tag,
      keyVersion: sealed.keyVersion,
      status: "connected",
    });
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    await ingestNumberMessages({ organizationId: A.id, directNumberId: numAna }, [
      msg("525533340001", "quiero precio"),
      msg("525533340002", "hola, soy tu primo"),
    ]);
    const mios = (await runWithOrganization(A.id, () => listMyChats(A.id, ana))).chats;
    deCliente = mios.find((c) => c.contact.phone?.endsWith("40001"))!.id;
    privado = mios.find((c) => c.contact.phone?.endsWith("40002"))!.id;
    await sys().update(schema.conversation).set({ clientMarkedAt: new Date(), clientMarkedBy: ana }).where(eq(schema.conversation.id, deCliente));
    const crear = async (userId: string) =>
      (await runWithOrganization(A.id, () =>
        createPersonalKey(sessionContext(userId, A.id, "asesor"), { name: "Claude", scopes: ["read", "write"], assistantName: "Joe" })
      ))!.key;
    llaveAna = await crear(ana);
    llaveBeto = await crear(beto);
  });

  beforeEach(async () => {
    calls.length = 0;
    resetDirectQueueForTests();
    await runWithOrganization(A.id, () =>
      saveDirectLimits(A.id, { limitsEnabled: false, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 }, null)
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    resetDirectQueueForTests();
    await borrarOrganizaciones([A.id]);
    await sys().delete(schema.evolutionServer).where(eq(schema.evolutionServer.id, serverId));
    await sys().delete(schema.user).where(inArray(schema.user.id, [owner, ana, beto]));
  });

  it("apagado (de fábrica): la IA no ve ni contesta ningún chat del número", async () => {
    const lista = await herramienta(llaveAna, "list_chats", { inbox: "mi_numero" });
    expect(lista.isError).toBe(true);
    expect(lista.structuredContent.error).toMatch(/Mi IA puede ver y contestar/);
    expect((await herramienta(llaveAna, "read_chat", { conversation_id: deCliente })).isError).toBe(true);
    expect((await herramienta(llaveAna, "send_message", { conversation_id: deCliente, text: "hola" })).isError).toBe(true);
    // La Bandeja de la empresa tampoco los trae.
    const empresa = await herramienta(llaveAna, "list_chats", {});
    expect(empresa.structuredContent.chats.map((c: any) => c.conversation_id)).not.toContain(deCliente);
    expect(calls).toHaveLength(0);
  });

  it("Ana lo enciende en su «Mi número» (y la pantalla sabe que hay conector)", async () => {
    const antes = await runWithOrganization(A.id, () => myNumber(A.id, ana));
    expect(antes).toMatchObject({ aiConnectorOffered: true, switches: { aiConnector: false } });
    await runWithOrganization(A.id, () => updateMyNumber(A.id, ana, { aiConnector: true }));
    const despues = await runWithOrganization(A.id, () => myNumber(A.id, ana));
    expect(despues!.switches.aiConnector).toBe(true);
    await interruptor({ aiConnector: false });
  });

  it("encendido sin «Compartir mis clientes» sigue sin ver nada", async () => {
    await interruptor({ aiConnector: true, shareClients: false });
    expect((await herramienta(llaveAna, "list_chats", { inbox: "mi_numero" })).isError).toBe(true);
    expect((await herramienta(llaveAna, "read_chat", { conversation_id: deCliente })).isError).toBe(true);
  });

  it("encendido: solo el chat de cliente; el privado no existe", async () => {
    await interruptor({ aiConnector: true, shareClients: true });
    const lista = await herramienta(llaveAna, "list_chats", { inbox: "mi_numero" });
    expect(lista.isError).toBe(false);
    expect(lista.structuredContent.chats.map((c: any) => c.conversation_id)).toEqual([deCliente]);
    const leido = await herramienta(llaveAna, "read_chat", { conversation_id: deCliente });
    expect(leido.isError).toBe(false);
    expect(leido.structuredContent.inbox).toBe("mi_numero");
    expect(leido.structuredContent.messages.map((m: any) => m.text)).toEqual(["quiero precio"]);
    expect((await herramienta(llaveAna, "read_chat", { conversation_id: privado })).isError).toBe(true);
    expect((await herramienta(llaveAna, "send_message", { conversation_id: privado, text: "x" })).isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("contesta por el dispositivo de SU número, firmado «Joe», y cuenta en el tope diario", async () => {
    await interruptor({ aiConnector: true, shareClients: true });
    const r = await herramienta(llaveAna, "send_message", { conversation_id: deCliente, text: "Te paso los precios" });
    expect(r.isError).toBe(false);
    expect(sends()).toHaveLength(1);
    expect(sends()[0]!.url).toMatch(/\/message\/sendText\/inst-ana-ia$/);
    const [m] = await sys().select().from(schema.message).where(eq(schema.message.id, r.structuredContent.message_id));
    expect(m).toMatchObject({ direction: "out", transport: "directa", text: "Te paso los precios", aiSenderName: "Joe" });
    expect(m!.aiConnectionId).not.toBeNull();
    // Tope de 2 en 24 h (mismo contador que la Bandeja).
    expect((await herramienta(llaveAna, "send_message", { conversation_id: deCliente, text: "dos" })).isError).toBe(false);
    const tope = await herramienta(llaveAna, "send_message", { conversation_id: deCliente, text: "tres" });
    expect(tope.isError).toBe(true);
    expect(tope.structuredContent.error).toMatch(/tope de 2/);
    expect(sends()).toHaveLength(2);
  });

  it("la IA de otra persona nunca ve el número de Ana", async () => {
    await interruptor({ aiConnector: true, shareClients: true });
    expect((await herramienta(llaveBeto, "list_chats", { inbox: "mi_numero" })).isError).toBe(true);
    expect((await herramienta(llaveBeto, "read_chat", { conversation_id: deCliente })).isError).toBe(true);
    expect((await herramienta(llaveBeto, "send_message", { conversation_id: deCliente, text: "x" })).isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("número desconectado: error claro y nada sale", async () => {
    await interruptor({ aiConnector: true, shareClients: true });
    await sys().delete(schema.aiActionLog).where(eq(schema.aiActionLog.organizationId, A.id));
    await sys().update(schema.directConnection).set({ status: "disconnected" }).where(eq(schema.directConnection.id, conexionAna));
    const r = await herramienta(llaveAna, "send_message", { conversation_id: deCliente, text: "hola" });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toMatch(/no está conectado/);
    expect(calls).toHaveLength(0);
    await sys().update(schema.directConnection).set({ status: "connected" }).where(eq(schema.directConnection.id, conexionAna));
  });
});
