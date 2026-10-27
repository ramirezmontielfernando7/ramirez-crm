import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { DeviceMessage } from "@/lib/direct-inbound";
import { runWithOrganization } from "@/lib/request-context";
import { sealForStorage } from "@/server/credentials";
import { insertServer } from "@/server/credentials/direct";
import { saveDirectLimits } from "@/server/direct-connection/limits";
import { resetDirectQueueForTests } from "@/server/direct-connection/send";
import { subscribe, type SseEvent } from "@/server/events/bus";
import { announceHandoff } from "@/server/inbox/handoff-notice";
import { SendError, sendText } from "@/server/inbox/send";
import { listMyChats, markClient, setChatAi } from "@/server/mi-numero/chats";
import { ingestNumberMessages } from "@/server/mi-numero/inbound";
import { MiNumeroFailure, updateMyNumber } from "@/server/mi-numero/numbers";
import { sendFromMyNumber } from "@/server/mi-numero/send";
import { forgetOrgModules } from "@/server/modules";
import { updateOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

const turnos = vi.hoisted(() => [] as string[]);
vi.mock("@/server/ai/trigger", () => ({
  maybeRunAgentTurn: async (conversationId: string) => {
    turnos.push(conversationId);
  },
}));

/**
 * Mi número (046), PR 8 — «La IA contesta mis chats», contra Postgres real
 * (RLS) y un servidor falso del dispositivo (`fetch`):
 *
 * - Solo chats «Es cliente» con el interruptor encendido; lo privado, nunca.
 * - La respuesta de la IA sale por el dispositivo de ESE número (nunca por
 *   Meta ni por el de la empresa) y queda marcada como de la IA.
 * - Si la persona escribe (Dashfort o su celular), la IA se pausa en ese
 *   chat; la reanuda ella. El aviso de lo que Dashfort está mandando no la pausa.
 * - Un chat de número jamás sale por el envío de siempre (persona, Meta).
 * - El aviso de «necesita a una persona» solo a quien lleva el número.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const sys = () => getSystemDb();
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

const BASE = "http://localhost:47813";
const LLAVE_ANA = "llave-ana-ia-0123456789";

type Call = { url: string; body: Record<string, unknown>; apikey: string | null };
const calls: Call[] = [];

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const headers = new Headers(init?.headers);
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  calls.push({ url: url.startsWith(BASE) ? url.slice(BASE.length) : `META ${url}`, body, apikey: headers.get("apikey") });
  if (url.includes("/chat/sendPresence/")) return Promise.resolve(Response.json({}));
  return Promise.resolve(Response.json({ key: { id: `EVO${calls.length}X${Date.now()}` }, status: "PENDING" }, { status: 201 }));
}
const sends = () => calls.filter((c) => !c.url.includes("sendPresence"));

async function crearMiembro(organizationId: string, name: string, role = "asesor"): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@x.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId, userId: id, role });
  return id;
}

let seq = 0;
function msg(phone: string, text: string, opts: { fromMe?: boolean } = {}): DeviceMessage {
  const keyId = `IA${++seq}${Date.now()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    keyId,
    fromMe: opts.fromMe ?? false,
    phone,
    lid: null,
    pushName: "Cliente",
    timestamp: ts,
    message: { type: "text", text: { body: text }, id: `direct.${keyId}`, timestamp: ts, ...(opts.fromMe ? { to: phone } : { from: phone }) } as DeviceMessage["message"],
  };
}

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (err instanceof MiNumeroFailure || err instanceof SendError) return err.code;
    throw err;
  }
}

describe("Mi número — la IA contesta los chats de cliente (PR 8)", () => {
  let A: Org;
  let fer: string;
  let ana: string;
  let numAna: string;
  let serverId: string;
  let cliente: string;
  let privado: string;
  const CLIENTE = "525544441001";
  const PRIVADO = "525544441002";
  const ref = () => ({ organizationId: A.id, directNumberId: numAna });
  const conv = async (id: string) => (await sys().select().from(schema.conversation).where(eq(schema.conversation.id, id)))[0]!;

  beforeAll(async () => {
    A = await crearOrganizacion("MiNumero IA A");
    fer = await crearMiembro(A.id, "Fer", "owner");
    ana = await crearMiembro(A.id, "Ana");
    await updateOrgModules(A.id, { conexionDirecta: true, miNumero: true, miNumeroMax: 3 }, "prueba");
    forgetOrgModules(A.id);
    numAna = newId("directNumber");
    await sys()
      .insert(schema.directNumber)
      .values({ id: numAna, organizationId: A.id, userId: ana, noticeAcceptedAt: new Date(), shareClients: true });
    const server = await insertServer(
      { name: `Prueba IA ${Math.random().toString(36).slice(2, 6)}`, baseUrl: `${BASE}/${Math.random().toString(36).slice(2, 8)}`, apiKey: "llave-maestra-0123456789" },
      null
    );
    serverId = server.id;
    const sealed = sealForStorage(LLAVE_ANA);
    await sys().insert(schema.directConnection).values({
      id: newId("directConnection"),
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
    await as(A.id, () => saveDirectLimits(A.id, { limitsEnabled: false, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 }, null));
    await ingestNumberMessages(ref(), [msg(CLIENTE, "hola, ¿precio?")]);
    await ingestNumberMessages(ref(), [msg(PRIVADO, "hola hijo")]);
    const chats = (await as(A.id, () => listMyChats(A.id, ana))).chats;
    cliente = chats.find((c) => c.contact.phone === CLIENTE)!.id;
    privado = chats.find((c) => c.contact.phone === PRIVADO)!.id;
    await as(A.id, () => markClient(A.id, ana, cliente));
  });

  beforeEach(() => {
    calls.length = 0;
    turnos.length = 0;
    resetDirectQueueForTests();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    resetDirectQueueForTests();
    await borrarOrganizaciones([A.id]);
    await sys().delete(schema.evolutionServer).where(eq(schema.evolutionServer.id, serverId));
    await sys().delete(schema.user).where(inArray(schema.user.id, [fer, ana]));
  });

  it("con el interruptor apagado no contesta ni sale nada", async () => {
    expect((await conv(cliente)).aiEnabled).toBe(false);
    await ingestNumberMessages(ref(), [msg(CLIENTE, "¿sigues ahí?")]);
    expect(turnos).toEqual([]);
    expect(await codigo(as(A.id, () => sendText({ conversationId: cliente, organizationId: A.id, text: "x", aiGenerated: true })))).toBe("not_connected");
    expect(sends()).toEqual([]);
  });

  it("encendido: solo el chat de cliente; lo privado jamás", async () => {
    await as(A.id, () => updateMyNumber(A.id, ana, { aiReplies: true }));
    expect((await conv(cliente)).aiEnabled).toBe(true);
    expect((await conv(privado)).aiEnabled).toBe(false);
    const lista = (await as(A.id, () => listMyChats(A.id, ana))).chats;
    expect(lista.find((c) => c.id === cliente)!.ai).toBe("on");
    expect(lista.find((c) => c.id === privado)!.ai).toBeNull();

    await ingestNumberMessages(ref(), [msg(CLIENTE, "¿tienen en azul?")]);
    await ingestNumberMessages(ref(), [msg(PRIVADO, "¿vienes a comer?")]);
    expect(turnos).toEqual([cliente]);
    expect(await codigo(as(A.id, () => sendText({ conversationId: privado, organizationId: A.id, text: "x", aiGenerated: true })))).toBe("not_connected");
  });

  it("la respuesta de la IA sale por el dispositivo de Ana, marcada como de la IA", async () => {
    const r = await as(A.id, () => sendText({ conversationId: cliente, organizationId: A.id, text: "Sí, en azul hay.", aiGenerated: true }));
    expect(sends().map((c) => c.url.replace(/^\/[a-z0-9]+/, ""))).toEqual(["/message/sendText/inst-ana-ia"]);
    expect(sends()[0]!.apikey).toBe(LLAVE_ANA);
    expect(calls.some((c) => c.url.startsWith("META"))).toBe(false);
    const [m] = await sys().select().from(schema.message).where(eq(schema.message.id, r.messageId));
    expect(m).toMatchObject({ conversationId: cliente, direction: "out", aiGenerated: true, transport: "directa" });
  });

  it("un chat de número nunca sale por el envío de siempre de una persona", async () => {
    expect(await codigo(as(A.id, () => sendText({ conversationId: cliente, organizationId: A.id, text: "x", allowDirect: true })))).toBe("meta_error");
    expect(sends()).toEqual([]);
  });

  it("el aviso de un envío de Dashfort que va saliendo no pausa la IA; lo que Ana escribe en su celular, sí", async () => {
    // Un envío en curso (aún sin ID del dispositivo) y su aviso que llega antes.
    const enCurso = newId("message");
    await sys().insert(schema.message).values({
      id: enCurso,
      organizationId: A.id,
      conversationId: cliente,
      direction: "out",
      type: "text",
      text: "va saliendo",
      status: "pending",
      transport: "directa",
      aiGenerated: true,
    });
    await ingestNumberMessages(ref(), [msg(CLIENTE, "va saliendo", { fromMe: true })]);
    expect((await conv(cliente)).handoffAt).toBeNull();
    await sys().update(schema.message).set({ status: "sent", altMessageId: "YA" }).where(eq(schema.message.id, enCurso));

    await ingestNumberMessages(ref(), [msg(CLIENTE, "Yo te atiendo, María", { fromMe: true })]);
    expect((await conv(cliente)).handoffAt).not.toBeNull();
    expect((await as(A.id, () => listMyChats(A.id, ana))).chats.find((c) => c.id === cliente)!.ai).toBe("paused");
    await ingestNumberMessages(ref(), [msg(CLIENTE, "gracias")]);
    expect(turnos).toEqual([]);
  });

  it("Ana la reanuda; si contesta desde Dashfort, se vuelve a pausar", async () => {
    await as(A.id, () => setChatAi(A.id, ana, cliente, true));
    expect((await conv(cliente)).handoffAt).toBeNull();
    await ingestNumberMessages(ref(), [msg(CLIENTE, "otra pregunta")]);
    expect(turnos).toEqual([cliente]);

    await as(A.id, () => sendFromMyNumber(A.id, ana, cliente, { text: "Te llamo" }));
    expect((await conv(cliente)).handoffAt).not.toBeNull();
    // En lo privado no hay IA que reanudar; y nadie más que Ana la toca.
    expect(await codigo(as(A.id, () => setChatAi(A.id, ana, privado, true)))).toBe("ai_off");
    expect(await codigo(as(A.id, () => setChatAi(A.id, fer, cliente, true)))).toBe("not_found");
  });

  it("«necesita a una persona» solo le llega a Ana", async () => {
    const eventos: SseEvent[] = [];
    const off = subscribe(A.id, (e) => eventos.push(e));
    await as(A.id, () => announceHandoff(A.id, cliente, "cliente"));
    off();
    expect(eventos.map((e) => e.type)).toEqual(["number.conversation"]);
    expect((eventos[0] as { audience?: readonly string[] }).audience).toEqual([ana]);
  });

  it("apagar el interruptor la apaga en todos sus chats", async () => {
    await as(A.id, () => updateMyNumber(A.id, ana, { aiReplies: false }));
    expect((await conv(cliente)).aiEnabled).toBe(false);
    const fila = await sys()
      .select()
      .from(schema.conversation)
      .where(and(eq(schema.conversation.directNumberId, numAna), eq(schema.conversation.aiEnabled, true)));
    expect(fila).toEqual([]);
  });
});
