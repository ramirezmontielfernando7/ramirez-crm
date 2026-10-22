import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { DIRECT_TIMEOUT_TEXT } from "@/lib/direct-send";
import { runWithOrganization } from "@/lib/request-context";
import { sealForStorage } from "@/server/credentials";
import { insertServer } from "@/server/credentials/direct";
import { ensureWebhookEvents, hashToken, resetWebhookEventsCheckForTests } from "@/server/direct-connection/link";
import { resetDirectQueueForTests } from "@/server/direct-connection/send";
import { saveDirectLimits } from "@/server/direct-connection/limits";
import { ingestInboundMessage, processEchoesValue } from "@/server/inbox/ingest";
import { sendText } from "@/server/inbox/send";
import { forgetOrgModules } from "@/server/modules";
import { POST as directWebhook } from "@/app/api/webhooks/direct/[token]/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Conexión directa (PR 4) — unir el eco de Meta con lo que salió por el
 * dispositivo vinculado, contra Postgres real (la app como `vocero_app`, con
 * RLS) y un servidor falso:
 *
 * - Por ID exacto (el `wamid` del eco trae el ID del dispositivo), llegue
 *   antes o después de que el envío sepa su ID: una sola burbuja, sin pausar
 *   la IA. Un reintento de Meta no hace nada.
 * - Respaldo por texto y hora si el ID no se puede leer; un envío que se
 *   agotó sin saber si salió pasa a «enviado» con su eco.
 * - Lo escrito en el celular entra como siempre (y guarda el ID para sus
 *   palomitas). Sin el complemento, nada cambia.
 * - Palomitas del dispositivo (`messages.update`) por el webhook, sin
 *   retroceder; y el webhook de una instancia vieja se pone al día.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

const BASE = "http://localhost:47812";
const TOKEN_A = "a".repeat(48);
const TOKEN_B = "b".repeat(48);

type Call = { url: string; body: Record<string, unknown> };
const calls: Call[] = [];
/** El ID que el servidor falso le da al siguiente envío. */
let nextId = "3EB0000000000000";
/** Retraso del servidor falso al enviar (para que el eco llegue antes). */
let sendDelayMs = 0;
let webhookFind: unknown = { enabled: true, events: ["CONNECTION_UPDATE"] };

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  if (url.startsWith(BASE)) {
    calls.push({ url: url.slice(BASE.length), body });
    if (url.includes("/chat/sendPresence/")) return Response.json({});
    if (url.includes("/webhook/find/")) return Response.json(webhookFind);
    if (url.includes("/webhook/set/")) return Response.json({ ok: true });
    if (sendDelayMs) await new Promise((r) => setTimeout(r, sendDelayMs));
    return Response.json({ key: { id: nextId }, status: "PENDING" }, { status: 201 });
  }
  calls.push({ url: `META ${url}`, body });
  return Response.json({ messages: [{ id: `wamid.${Math.random().toString(36).slice(2)}` }] });
}

/** Un `wamid` con la forma vista en la Fase 0, que termina con el ID del dispositivo. */
function wamid(phone: string, id: string) {
  const bytes = Buffer.concat([
    Buffer.from([0x1c, 0x18, phone.length]),
    Buffer.from(phone, "latin1"),
    Buffer.from([0x15, 0x02, 0x00, 0x11, 0x18, id.length]),
    Buffer.from(id, "latin1"),
    Buffer.from([0x00]),
  ]);
  return `wamid.${bytes.toString("base64")}`;
}

let seq = 0;
const evoId = () => `3EB0${(++seq).toString(16).toUpperCase().padStart(12, "0")}`;
const telefono = () => `5255${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;

describe("conexión directa — unir el eco de Meta", () => {
  let A: Org;
  let B: Org;
  let serverId: string;

  async function modulo(org: string, on: boolean) {
    await getSystemDb()
      .insert(schema.organizationModule)
      .values({ organizationId: org, conexionDirecta: on })
      .onConflictDoUpdate({ target: schema.organizationModule.organizationId, set: { conexionDirecta: on } });
    forgetOrgModules(org);
  }

  async function chat(org: string, phone = telefono()) {
    return as(org, async () => {
      const contactId = newId("contact");
      await getDb().insert(schema.contact).values({ id: contactId, organizationId: org, waIdentity: phone, phone, name: "Cliente" });
      const id = newId("conversation");
      await getDb().insert(schema.conversation).values({ id, organizationId: org, contactId, connectionMode: "directa" });
      return { id, phone };
    });
  }

  const mensajes = (org: string, conversationId: string) =>
    as(org, () =>
      getDb()
        .select()
        .from(schema.message)
        .where(and(eq(schema.message.organizationId, org), eq(schema.message.conversationId, conversationId)))
        .orderBy(schema.message.createdAt)
    );

  const conversacion = async (org: string, id: string) =>
    (await as(org, () => getDb().select().from(schema.conversation).where(eq(schema.conversation.id, id))))[0]!;

  /** El eco que manda Meta (como lo procesa el webhook de verdad). */
  function eco(org: Org, to: string, id: string, msg: Record<string, unknown> = { type: "text", text: { body: "Hola" } }) {
    return processEchoesValue({
      metadata: { phone_number_id: org.phoneNumberId },
      message_echoes: [{ id, to, from: "5215500000000", timestamp: String(Math.floor(Date.now() / 1000)), ...msg }],
    } as unknown as Parameters<typeof processEchoesValue>[0]);
  }

  async function conexion(org: Org, instanceName: string, token: string) {
    const sealed = sealForStorage(`llave-${instanceName}-0123456789`);
    await as(org.id, () =>
      getDb().insert(schema.directConnection).values({
        id: newId("directConnection"),
        organizationId: org.id,
        serverId,
        instanceName,
        instanceKeyCipher: sealed.cipher,
        instanceKeyIv: sealed.iv,
        instanceKeyTag: sealed.tag,
        keyVersion: sealed.keyVersion,
        webhookTokenHash: hashToken(token),
        status: "connected",
      })
    );
    await as(org.id, () => saveDirectLimits(org.id, { limitsEnabled: false, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 }, null));
  }

  function webhook(token: string, body: unknown) {
    return directWebhook(new Request(`http://x/api/webhooks/direct/${token}`, { method: "POST", body: JSON.stringify(body) }), {
      params: Promise.resolve({ token }),
    });
  }

  beforeAll(async () => {
    A = await crearOrganizacion("Ecos directa A");
    B = await crearOrganizacion("Ecos directa B");
    await modulo(A.id, true);
    await modulo(B.id, false);
    const server = await insertServer(
      { name: `Ecos ${Math.random().toString(36).slice(2, 6)}`, baseUrl: `${BASE}/${Math.random().toString(36).slice(2, 8)}`, apiKey: "llave-maestra-0123456789" },
      null
    );
    serverId = server.id;
    await conexion(A, "inst-eco-a", TOKEN_A);
    await conexion(B, "inst-eco-b", TOKEN_B);
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
  });

  beforeEach(() => {
    calls.length = 0;
    sendDelayMs = 0;
    resetDirectQueueForTests();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    resetDirectQueueForTests();
    await borrarOrganizaciones([A.id, B.id]);
    await getSystemDb().delete(schema.evolutionServer).where(eq(schema.evolutionServer.id, serverId));
  });

  it("el eco de un envío directo se une por ID: una sola burbuja y la IA sigue igual", async () => {
    const c = await chat(A.id);
    nextId = evoId();
    await as(A.id, () => sendText({ organizationId: A.id, conversationId: c.id, text: "Hola", allowDirect: true }));
    const echoId = wamid(`521${c.phone.slice(2)}`, nextId);
    await eco(A, c.phone, echoId);

    const ms = await mensajes(A.id, c.id);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ transport: "directa", origin: "operator", altMessageId: nextId, waMessageId: echoId, status: "sent" });
    const conv = await conversacion(A.id, c.id);
    expect(conv.handoffAt).toBeNull();
    expect(conv.aiEnabled).toBe(true);

    // Meta reintenta el mismo eco: nada cambia.
    await eco(A, c.phone, echoId);
    expect(await mensajes(A.id, c.id)).toHaveLength(1);
  });

  it("el eco que llega ANTES de que el dispositivo conteste espera y se une igual por ID", async () => {
    const c = await chat(A.id);
    nextId = evoId();
    const echoId = wamid(`521${c.phone.slice(2)}`, nextId);
    sendDelayMs = 1200;
    const envio = as(A.id, () => sendText({ organizationId: A.id, conversationId: c.id, text: "Hola", allowDirect: true }));
    // El envío ya está guardado y esperando al dispositivo cuando llega el eco.
    await new Promise((r) => setTimeout(r, 300));
    await Promise.all([envio, eco(A, c.phone, echoId)]);

    const ms = await mensajes(A.id, c.id);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ altMessageId: nextId, waMessageId: echoId, status: "sent" });
    expect((await conversacion(A.id, c.id)).handoffAt).toBeNull();
  });

  it("una foto enviada por la directa se une por ID (su eco trae otro archivo de Meta)", async () => {
    const c = await chat(A.id);
    const id = evoId();
    await as(A.id, () =>
      getDb().insert(schema.message).values({
        id: newId("message"),
        organizationId: A.id,
        conversationId: c.id,
        direction: "out",
        type: "image",
        status: "sent",
        transport: "directa",
        altMessageId: id,
        sentAt: new Date(),
      })
    );
    const echoId = wamid(`521${c.phone.slice(2)}`, id);
    await eco(A, c.phone, echoId, { type: "image", image: { id: "media-meta-1", mime_type: "image/jpeg" } });
    const ms = await mensajes(A.id, c.id);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ waMessageId: echoId, mediaAssetId: null });
    const assets = await as(A.id, () => getDb().select().from(schema.mediaAsset).where(eq(schema.mediaAsset.waMediaId, "media-meta-1")));
    expect(assets).toHaveLength(0);
  });

  it("respaldo: si el ID no se puede leer, se une por texto y hora del mismo chat", async () => {
    const c = await chat(A.id);
    nextId = evoId();
    await as(A.id, () => sendText({ organizationId: A.id, conversationId: c.id, text: "Precio del paquete", allowDirect: true }));
    await eco(A, c.phone, "wamid.ilegible-123", { type: "text", text: { body: "Precio del paquete" } });
    const ms = await mensajes(A.id, c.id);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ waMessageId: "wamid.ilegible-123", altMessageId: nextId });
  });

  it("un envío que se agotó sin saber si salió pasa a «enviado» cuando llega su eco", async () => {
    const c = await chat(A.id);
    await as(A.id, () =>
      getDb().insert(schema.message).values({
        id: newId("message"),
        organizationId: A.id,
        conversationId: c.id,
        direction: "out",
        type: "text",
        text: "¿Sigues ahí?",
        status: "failed",
        error: DIRECT_TIMEOUT_TEXT,
        failedAt: new Date(),
        transport: "directa",
        sentAt: new Date(),
      })
    );
    const echoId = wamid(`521${c.phone.slice(2)}`, evoId());
    await eco(A, c.phone, echoId, { type: "text", text: { body: "¿Sigues ahí?" } });
    const ms = await mensajes(A.id, c.id);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ status: "sent", error: null, failedAt: null, waMessageId: echoId });
  });

  it("lo escrito en el celular entra como siempre (pausa la IA) y guarda el ID del dispositivo", async () => {
    const c = await chat(A.id);
    nextId = evoId();
    await as(A.id, () => sendText({ organizationId: A.id, conversationId: c.id, text: "Hola", allowDirect: true }));
    // Mismo texto, pero OTRO mensaje (otro ID): no se une por texto.
    const otro = evoId();
    const echoId = wamid(`521${c.phone.slice(2)}`, otro);
    await eco(A, c.phone, echoId);
    const ms = await mensajes(A.id, c.id);
    expect(ms).toHaveLength(2);
    expect(ms.find((m) => m.waMessageId === echoId)).toMatchObject({ origin: "manual", altMessageId: otro, transport: null });
    expect((await conversacion(A.id, c.id)).handoffReason).toBe("manual_reply");
  });

  it("sin el complemento, el eco entra como siempre y sin ID del dispositivo", async () => {
    const c = await chat(B.id);
    const echoId = wamid(`521${c.phone.slice(2)}`, evoId());
    await eco(B, c.phone, echoId);
    const ms = await mensajes(B.id, c.id);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ origin: "manual", altMessageId: null, waMessageId: echoId });
  });

  it("regreso a Oficial: el eco unido y las palomitas NO lo disparan; un mensaje del contacto sí", async () => {
    const c = await chat(A.id);
    nextId = evoId();
    const id = nextId;
    await as(A.id, () => sendText({ organizationId: A.id, conversationId: c.id, text: "Hola", allowDirect: true }));
    await eco(A, c.phone, wamid(`521${c.phone.slice(2)}`, id));
    await webhook(TOKEN_A, { event: "messages.update", data: { keyId: id, fromMe: true, status: "READ" } });
    expect((await conversacion(A.id, c.id)).connectionMode).toBe("directa");

    await ingestInboundMessage({
      organizationId: A.id,
      identity: { identity: c.phone, phone: c.phone, waUserId: null, profileName: null },
      waMessageId: `wamid.in-${newId("message")}`,
      type: "text",
      text: "Gracias",
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    expect((await conversacion(A.id, c.id)).connectionMode).toBe("meta");
  });

  it("palomitas del dispositivo: entregado y leído, sin retroceder", async () => {
    const c = await chat(A.id);
    nextId = evoId();
    const id = nextId;
    await as(A.id, () => sendText({ organizationId: A.id, conversationId: c.id, text: "Hola", allowDirect: true }));

    let r = await webhook(TOKEN_A, { event: "messages.update", data: { keyId: id, fromMe: true, status: "DELIVERY_ACK", remoteJid: `521${c.phone.slice(2)}@s.whatsapp.net` } });
    expect(r.status).toBe(200);
    expect((await mensajes(A.id, c.id))[0]).toMatchObject({ status: "delivered" });

    r = await webhook(TOKEN_A, { event: "MESSAGES_UPDATE", data: { keyId: id, fromMe: true, status: "READ" } });
    expect(r.status).toBe(200);
    // Un «entregado» tardío no regresa a dos palomitas grises.
    await webhook(TOKEN_A, { event: "messages.update", data: { keyId: id, fromMe: true, status: "DELIVERY_ACK" } });
    const [m] = await mensajes(A.id, c.id);
    expect(m).toMatchObject({ status: "read" });
    expect(m!.deliveredAt).not.toBeNull();
    expect(m!.readAt).not.toBeNull();
  });

  it("las palomitas no cruzan de empresa, y un token que no existe es 404", async () => {
    const c = await chat(A.id);
    nextId = evoId();
    const id = nextId;
    await as(A.id, () => sendText({ organizationId: A.id, conversationId: c.id, text: "Hola", allowDirect: true }));
    // El token de B (sin complemento) no toca el mensaje de A.
    expect((await webhook(TOKEN_B, { event: "messages.update", data: { keyId: id, fromMe: true, status: "READ" } })).status).toBe(200);
    expect((await mensajes(A.id, c.id))[0]).toMatchObject({ status: "sent" });
    expect((await webhook("c".repeat(48), { event: "messages.update", data: { keyId: id, fromMe: true, status: "READ" } })).status).toBe(404);
  });

  it("una instancia vinculada antes de este cambio recibe el webhook con las palomitas (una vez)", async () => {
    resetWebhookEventsCheckForTests();
    const [row] = await as(A.id, () => getDb().select().from(schema.directConnection).where(eq(schema.directConnection.organizationId, A.id)));
    const server = { baseUrl: `${BASE}/srv`, apiKey: "llave-maestra-0123456789" };
    webhookFind = { enabled: true, events: ["CONNECTION_UPDATE"] };
    await ensureWebhookEvents(row!, server);
    const set = calls.find((c) => c.url.includes("/webhook/set/inst-eco-a"));
    expect(set?.body).toMatchObject({ webhook: { events: ["CONNECTION_UPDATE", "MESSAGES_UPDATE", "MESSAGES_UPSERT"] } });
    const [after] = await as(A.id, () => getDb().select().from(schema.directConnection).where(eq(schema.directConnection.organizationId, A.id)));
    expect(after!.webhookTokenHash).not.toBe(hashToken(TOKEN_A));
    const nuevo = /\/api\/webhooks\/direct\/([a-f0-9]{48})$/.exec(String((set!.body.webhook as { url: string }).url))![1]!;
    expect(after!.webhookTokenHash).toBe(hashToken(nuevo));

    // Ya al día: no se vuelve a tocar.
    calls.length = 0;
    await ensureWebhookEvents(after!, server);
    expect(calls).toHaveLength(0);

    // PR 6: una del PR 4 (con palomitas, sin mensajes) también se pone al día.
    resetWebhookEventsCheckForTests();
    webhookFind = { enabled: true, events: ["CONNECTION_UPDATE", "MESSAGES_UPDATE"] };
    await ensureWebhookEvents(after!, server);
    expect(calls.filter((c) => c.url.includes("/webhook/set/"))).toHaveLength(1);

    // Y una que ya tiene todo no se toca.
    calls.length = 0;
    resetWebhookEventsCheckForTests();
    const [ultima] = await as(A.id, () => getDb().select().from(schema.directConnection).where(eq(schema.directConnection.organizationId, A.id)));
    webhookFind = { enabled: true, events: ["CONNECTION_UPDATE", "MESSAGES_UPDATE", "MESSAGES_UPSERT"] };
    await ensureWebhookEvents(ultima!, server);
    expect(calls.filter((c) => c.url.includes("/webhook/set/"))).toHaveLength(0);
  });
});
