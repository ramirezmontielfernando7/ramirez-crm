import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

// El webhook responde ya y registra después (`after`): aquí se espera a mano.
const pendientes = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<unknown>) => {
    pendientes.push(fn());
  },
}));

import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { sealForStorage } from "@/server/credentials";
import { insertServer } from "@/server/credentials/direct";
import { hashToken } from "@/server/direct-connection/link";
import { saveDirectLimits } from "@/server/direct-connection/limits";
import { resetDirectQueueForTests } from "@/server/direct-connection/send";
import { inboxDirectContext } from "@/server/direct-connection/mode";
import { setOrganizationAiViaDirect } from "@/server/platform-admin/direct-servers";
import { SendError, sendText } from "@/server/inbox/send";
import { forgetOrgModules } from "@/server/modules";
import { ensureAssetAvailable } from "@/server/whatsapp/media";
import { POST as directWebhook } from "@/app/api/webhooks/direct/[token]/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Conexión directa (PR 6) — empresa SIN Meta, contra Postgres real (la app
 * como `vocero_app`, con RLS) y un servidor del dispositivo falso:
 *
 * - Lo que escribe el contacto entra por el webhook del dispositivo: contacto
 *   (52 + 10), conversación, lead y no leídos; un reintento no duplica.
 * - Con Meta, el mismo aviso no registra nada (ya entra por Meta).
 * - Una persona contesta con la ventana cerrada y sale por el dispositivo; la
 *   copia que el dispositivo regresa se une (una burbuja, la IA sigue).
 * - Lo escrito en el celular entra como «Celular» y pausa la IA.
 * - La IA contesta por el dispositivo solo con el ajuste de plataforma.
 * - Los archivos se descargan del dispositivo, no de Meta.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

const BASE = "http://localhost:47813";
const TOKEN_S = "c".repeat(48);
const TOKEN_M = "d".repeat(48);

type Call = { url: string; body: Record<string, unknown> };
const calls: Call[] = [];
let nextId = "3EB0000000000000";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  if (url.startsWith(BASE)) {
    calls.push({ url: url.slice(BASE.length), body });
    if (url.includes("/chat/sendPresence/")) return Response.json({});
    if (url.includes("/chat/getBase64FromMediaMessage/")) {
      return Response.json({ base64: PNG.toString("base64"), mimetype: "image/png" });
    }
    return Response.json({ key: { id: nextId }, status: "PENDING" }, { status: 201 });
  }
  calls.push({ url: `META ${url}`, body });
  return Response.json({ messages: [{ id: `wamid.${Math.random().toString(36).slice(2)}` }] });
}

let seq = 0;
const evoId = () => `3EB1${(++seq).toString(16).toUpperCase().padStart(12, "0")}`;
const diez = () => `55${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;

describe("conexión directa — empresa sin Meta", () => {
  let S: Org;
  let M: Org;
  let serverId: string;
  let mediaDir: string;
  const prevMedia = process.env.MEDIA_DIR;

  async function modulo(org: string) {
    await getSystemDb()
      .insert(schema.organizationModule)
      .values({ organizationId: org, conexionDirecta: true })
      .onConflictDoUpdate({ target: schema.organizationModule.organizationId, set: { conexionDirecta: true } });
    forgetOrgModules(org);
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

  async function webhook(token: string, data: unknown, event = "messages.upsert") {
    const res = await directWebhook(
      new Request(`http://x/api/webhooks/direct/${token}`, { method: "POST", body: JSON.stringify({ event, data }) }),
      { params: Promise.resolve({ token }) }
    );
    await Promise.all(pendientes.splice(0));
    return res;
  }

  /** Un aviso del dispositivo con la forma de Evolution v2. */
  function upsert(phone10: string, id: string, message: Record<string, unknown>, fromMe = false, pushName = "Ana") {
    return {
      key: { remoteJid: `521${phone10}@s.whatsapp.net`, fromMe, id },
      pushName,
      message,
      messageType: Object.keys(message)[0],
      messageTimestamp: Math.floor(Date.now() / 1000),
    };
  }

  const contacto = async (org: string, phone: string) =>
    (await as(org, () =>
      getDb().select().from(schema.contact).where(and(eq(schema.contact.organizationId, org), eq(schema.contact.phone, phone)))
    ))[0];

  const conversacionDe = async (org: string, contactId: string) =>
    (await as(org, () => getDb().select().from(schema.conversation).where(eq(schema.conversation.contactId, contactId))))[0]!;

  const mensajes = (org: string, conversationId: string) =>
    as(org, () =>
      getDb()
        .select()
        .from(schema.message)
        .where(and(eq(schema.message.organizationId, org), eq(schema.message.conversationId, conversationId)))
        .orderBy(schema.message.createdAt)
    );

  /** El contacto escribe y devuelve su conversación. */
  async function escribe(org: Org, token: string, phone10 = diez(), text = "Hola, ¿precio?") {
    const id = evoId();
    expect((await webhook(token, upsert(phone10, id, { conversation: text }))).status).toBe(200);
    const c = await contacto(org.id, `52${phone10}`);
    return { phone10, keyId: id, contact: c, conv: c ? await conversacionDe(org.id, c.id) : null };
  }

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), "sin-meta-"));
    process.env.MEDIA_DIR = mediaDir;
    S = await crearOrganizacion("Sin Meta");
    M = await crearOrganizacion("Con Meta");
    // La empresa sin Meta: sin número de WhatsApp de Meta guardado.
    await as(S.id, () => getDb().delete(schema.metaCredentials).where(eq(schema.metaCredentials.organizationId, S.id)));
    await modulo(S.id);
    await modulo(M.id);
    const server = await insertServer(
      { name: `SinMeta ${Math.random().toString(36).slice(2, 6)}`, baseUrl: `${BASE}/${Math.random().toString(36).slice(2, 8)}`, apiKey: "llave-maestra-0123456789" },
      null
    );
    serverId = server.id;
    await conexion(S, "inst-sinmeta-s", TOKEN_S);
    await conexion(M, "inst-sinmeta-m", TOKEN_M);
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
  });

  beforeEach(() => {
    calls.length = 0;
    resetDirectQueueForTests();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    resetDirectQueueForTests();
    if (prevMedia === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = prevMedia;
    await rm(mediaDir, { recursive: true, force: true });
    await borrarOrganizaciones([S.id, M.id]);
    await getSystemDb().delete(schema.evolutionServer).where(eq(schema.evolutionServer.id, serverId));
  });

  it("lo que escribe el contacto entra por el dispositivo: contacto, conversación, lead y no leídos", async () => {
    const { keyId, contact, conv } = await escribe(S, TOKEN_S);
    expect(contact).toMatchObject({ name: "Ana" });
    expect(conv).toMatchObject({ unreadCount: 1, channel: "whatsapp" });
    expect(conv!.lastInboundAt).not.toBeNull();
    const ms = await mensajes(S.id, conv!.id);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({
      direction: "in",
      type: "text",
      text: "Hola, ¿precio?",
      transport: "directa",
      altMessageId: keyId,
      waMessageId: `direct.${keyId}`,
    });
    const leads = await as(S.id, () => getDb().select().from(schema.lead).where(eq(schema.lead.contactId, contact!.id)));
    expect(leads).toHaveLength(1);

    // El servidor reintenta el mismo aviso: nada se duplica.
    await webhook(TOKEN_S, upsert(contact!.phone!.slice(2), keyId, { conversation: "Hola, ¿precio?" }));
    expect(await mensajes(S.id, conv!.id)).toHaveLength(1);
    expect((await conversacionDe(S.id, contact!.id)).unreadCount).toBe(1);
  });

  it("con Meta, el mismo aviso no registra nada (ya entra por Meta)", async () => {
    const r = await escribe(M, TOKEN_M);
    expect(r.contact).toBeUndefined();
  });

  it("un token que no existe responde 404 sin efectos", async () => {
    expect((await webhook("e".repeat(48), upsert(diez(), evoId(), { conversation: "x" }))).status).toBe(404);
  });

  it("una persona contesta con la ventana cerrada: sale por el dispositivo y su copia se une", async () => {
    const { conv, phone10 } = await escribe(S, TOKEN_S);
    // Ventana cerrada (el contacto escribió hace 2 días).
    await as(S.id, () =>
      getDb()
        .update(schema.conversation)
        .set({ lastInboundAt: new Date(Date.now() - 48 * 3600_000) })
        .where(eq(schema.conversation.id, conv!.id))
    );
    nextId = evoId();
    await as(S.id, () => sendText({ organizationId: S.id, conversationId: conv!.id, text: "Claro, son $500", allowDirect: true }));
    const send = calls.find((c) => c.url.includes("/message/sendText/"));
    expect(send?.body).toMatchObject({ number: `521${phone10}`, text: "Claro, son $500" });
    expect(calls.some((c) => c.url.startsWith("META"))).toBe(false);

    // El dispositivo regresa la copia de lo enviado (fromMe, mismo ID).
    await webhook(TOKEN_S, upsert(phone10, nextId, { conversation: "Claro, son $500" }, true));
    const ms = await mensajes(S.id, conv!.id);
    expect(ms.filter((m) => m.direction === "out")).toHaveLength(1);
    expect(ms.at(-1)).toMatchObject({ transport: "directa", origin: "operator", altMessageId: nextId, waMessageId: `direct.${nextId}` });
    expect((await conversacionDe(S.id, conv!.contactId)).handoffAt).toBeNull();
  });

  it("lo escrito en el celular entra como «Celular» y pausa la IA", async () => {
    const { conv, phone10 } = await escribe(S, TOKEN_S);
    const id = evoId();
    await webhook(TOKEN_S, upsert(phone10, id, { conversation: "Te marco en 5" }, true));
    const ms = await mensajes(S.id, conv!.id);
    expect(ms.at(-1)).toMatchObject({ direction: "out", origin: "manual", transport: "directa", altMessageId: id, text: "Te marco en 5" });
    expect(await conversacionDe(S.id, conv!.contactId)).toMatchObject({ handoffReason: "manual_reply", aiEnabled: false });
  });

  it("la IA contesta por el dispositivo solo con «IA por conexión directa» encendido", async () => {
    const { conv } = await escribe(S, TOKEN_S);
    const ia = () => as(S.id, () => sendText({ organizationId: S.id, conversationId: conv!.id, text: "Hola, soy el asistente", aiGenerated: true }));
    // Apagado de fábrica: sale por Meta, que esta empresa no tiene.
    await expect(ia()).rejects.toMatchObject({ code: "not_connected" });
    expect(calls.some((c) => c.url.includes("/message/sendText/"))).toBe(false);

    await setOrganizationAiViaDirect(S.id, true, null, null);
    nextId = evoId();
    await ia();
    const ultimo = (await mensajes(S.id, conv!.id)).at(-1);
    expect(ultimo).toMatchObject({ transport: "directa", origin: "ai", aiGenerated: true, altMessageId: nextId });
    await setOrganizationAiViaDirect(S.id, false, null, null);
  });

  it("con Meta la IA sale por Meta aunque el ajuste esté encendido", async () => {
    const phone = `52${diez()}`;
    const conv = await as(M.id, async () => {
      const contactId = newId("contact");
      await getDb().insert(schema.contact).values({ id: contactId, organizationId: M.id, waIdentity: phone, phone, name: "Cliente" });
      const id = newId("conversation");
      await getDb()
        .insert(schema.conversation)
        .values({ id, organizationId: M.id, contactId, connectionMode: "directa", lastInboundAt: new Date() });
      return id;
    });
    await setOrganizationAiViaDirect(M.id, true, null, null);
    await as(M.id, () => sendText({ organizationId: M.id, conversationId: conv, text: "Hola", aiGenerated: true }));
    expect(calls.some((c) => c.url.startsWith("META"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/message/sendText/"))).toBe(false);
  });

  it("una foto del contacto se descarga del dispositivo, no de Meta", async () => {
    const phone10 = diez();
    const id = evoId();
    await webhook(TOKEN_S, upsert(phone10, id, { imageMessage: { mimetype: "image/png", caption: "mira" } }));
    const c = (await contacto(S.id, `52${phone10}`))!;
    const conv = await conversacionDe(S.id, c.id);
    const [m] = await mensajes(S.id, conv.id);
    expect(m).toMatchObject({ type: "image", transport: "directa" });
    const asset = await as(S.id, () => ensureAssetAvailable(S.id, m!.mediaAssetId!));
    expect(asset).toMatchObject({ fetchStatus: "available", caption: "mira", waMediaId: `direct:${id}`, fileSize: PNG.byteLength });
    const pedido = calls.find((x) => x.url.includes("/chat/getBase64FromMediaMessage/"));
    expect(pedido?.body).toMatchObject({ message: { key: { id } } });
    expect(calls.some((x) => x.url.startsWith("META"))).toBe(false);
  });

  it("un contacto que llega solo con su ID privado se reconoce si ya lo conocíamos", async () => {
    const phone10 = diez();
    const lid = `${Math.floor(Math.random() * 1e14)}@lid`;
    await webhook(TOKEN_S, {
      ...upsert(phone10, evoId(), { conversation: "primero" }),
      key: { remoteJid: lid, remoteJidAlt: `521${phone10}@s.whatsapp.net`, fromMe: false, id: evoId() },
    });
    const c = (await contacto(S.id, `52${phone10}`))!;
    expect(c.waLid).toBe(lid);
    await webhook(TOKEN_S, { ...upsert(phone10, evoId(), { conversation: "segundo" }), key: { remoteJid: lid, fromMe: false, id: evoId() } });
    const ms = await mensajes(S.id, (await conversacionDe(S.id, c.id)).id);
    expect(ms.map((m) => m.text)).toEqual(["primero", "segundo"]);
  });

  it("la Bandeja de una empresa sin Meta: todo Directa, sin selector", async () => {
    const ctx = await as(S.id, () => inboxDirectContext(S.id, true));
    expect(ctx).toMatchObject({ metaless: true, defaultMode: "directa", canChangeMode: false, deviceReady: true });
    const conMeta = await as(M.id, () => inboxDirectContext(M.id, true));
    expect(conMeta).toMatchObject({ metaless: false, defaultMode: "meta", canChangeMode: true });
  });

  it("sin dispositivo conectado falla claro, sin intentar Meta", async () => {
    const { conv } = await escribe(S, TOKEN_S);
    await as(S.id, () =>
      getDb().update(schema.directConnection).set({ status: "disconnected" }).where(eq(schema.directConnection.organizationId, S.id))
    );
    try {
      const err = await as(S.id, () =>
        sendText({ organizationId: S.id, conversationId: conv!.id, text: "Hola", allowDirect: true })
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SendError);
      expect(err).toMatchObject({ code: "not_connected" });
      expect(calls.some((c) => c.url.startsWith("META"))).toBe(false);
    } finally {
      await as(S.id, () =>
        getDb().update(schema.directConnection).set({ status: "connected" }).where(eq(schema.directConnection.organizationId, S.id))
      );
    }
  });
});
