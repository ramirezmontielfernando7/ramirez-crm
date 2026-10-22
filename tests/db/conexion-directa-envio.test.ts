import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { DIRECT_TEXT } from "@/lib/direct-connection";
import { runWithOrganization } from "@/lib/request-context";
import { sealForStorage } from "@/server/credentials";
import { insertServer } from "@/server/credentials/direct";
import {
  DIRECT_TIMEOUT_TEXT,
  dispatchQueued,
  resetDirectQueueForTests,
  resumeDirectQueue,
} from "@/server/direct-connection/send";
import { saveDirectLimits } from "@/server/direct-connection/limits";
import { SendError, sendMediaMessage, sendText } from "@/server/inbox/send";
import { forgetOrgModules } from "@/server/modules";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Conexión directa (PR 3) — envío por el dispositivo vinculado contra
 * Postgres real (la app como `vocero_app`, con RLS) y un servidor falso
 * (`fetch` interceptado):
 *
 * - Solo una persona desde la Bandeja (`allowDirect`) sale por la directa; la
 *   IA y todo lo demás siguen por Meta. Sin módulo, sin dispositivo o en modo
 *   Meta, nada cambia.
 * - «escribiendo…» antes de cada mensaje, con la llave de la instancia.
 * - Límites: el 2.º mensaje en 8 s queda «En cola» y sale solo a su hora.
 * - Freno: 2 fallos del dispositivo en un día pausan la directa 24 h; un
 *   número sin WhatsApp no cuenta.
 * - Archivos por la directa; contacto sin teléfono; arranque con fila.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

const BASE = "http://localhost:47811";
const LLAVE_INSTANCIA = "llave-instancia-a-0123456789";

type Call = { url: string; body: Record<string, unknown>; apikey: string | null };
const calls: Call[] = [];
/** Qué responde el servidor falso al siguiente envío (texto o archivo). */
let next: { status: number; body: unknown }[] = [];

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const headers = new Headers(init?.headers);
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  if (url.startsWith(BASE)) {
    calls.push({ url: url.slice(BASE.length), body, apikey: headers.get("apikey") });
    if (url.includes("/chat/sendPresence/")) return Promise.resolve(Response.json({}));
    const r = next.shift() ?? { status: 201, body: { key: { id: `EVO${calls.length}` }, status: "PENDING" } };
    return Promise.resolve(Response.json(r.body, { status: r.status }));
  }
  // Graph de Meta: acepta todo.
  calls.push({ url: `META ${url}`, body, apikey: null });
  return Promise.resolve(Response.json({ messages: [{ id: `wamid.${Math.random().toString(36).slice(2)}` }] }));
}

const evo = () => calls.filter((c) => !c.url.startsWith("META"));
const meta = () => calls.filter((c) => c.url.startsWith("META"));

describe("conexión directa — envío por el dispositivo vinculado", () => {
  let A: Org;
  let B: Org;
  let serverId: string;
  let mediaDir: string;
  const prevMedia = process.env.MEDIA_DIR;

  async function modulo(org: string, on: boolean) {
    await getSystemDb()
      .insert(schema.organizationModule)
      .values({ organizationId: org, conexionDirecta: on })
      .onConflictDoUpdate({ target: schema.organizationModule.organizationId, set: { conexionDirecta: on } });
    forgetOrgModules(org);
  }

  async function chat(org: string, opts: { mode?: "meta" | "directa" | "mixta" | null; phone?: string | null; inbound?: Date | null; isTest?: boolean } = {}) {
    return as(org, async () => {
      const contactId = newId("contact");
      const phone = opts.phone === undefined ? `52155${Math.floor(10_000_000 + Math.random() * 89_999_999)}` : opts.phone;
      await getDb().insert(schema.contact).values({
        id: contactId,
        organizationId: org,
        waIdentity: phone ?? `bsuid:${contactId}`,
        phone,
        name: "Cliente",
      });
      const id = newId("conversation");
      await getDb().insert(schema.conversation).values({
        id,
        organizationId: org,
        contactId,
        connectionMode: opts.mode === undefined ? "mixta" : opts.mode,
        lastInboundAt: opts.inbound ?? null,
        isTest: opts.isTest ?? false,
      });
      return id;
    });
  }

  async function mensajes(org: string, conversationId: string) {
    return as(org, () =>
      getDb()
        .select()
        .from(schema.message)
        .where(and(eq(schema.message.organizationId, org), eq(schema.message.conversationId, conversationId)))
    );
  }

  async function conexion(org: string) {
    const [c] = await as(org, () => getDb().select().from(schema.directConnection).where(eq(schema.directConnection.organizationId, org)));
    return c!;
  }

  async function setConexion(org: string, set: Partial<typeof schema.directConnection.$inferInsert>) {
    await as(org, () => getDb().update(schema.directConnection).set(set).where(eq(schema.directConnection.organizationId, org)));
  }

  async function sinLimites(org: string) {
    await as(org, () => saveDirectLimits(org, { limitsEnabled: false, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 }, null));
  }

  beforeAll(async () => {
    mediaDir = mkdtempSync(path.join(tmpdir(), "directa-"));
    process.env.MEDIA_DIR = mediaDir;
    resetEnvCacheForTests();
    A = await crearOrganizacion("Envio directo A");
    B = await crearOrganizacion("Envio directo B");
    for (const org of [A.id, B.id]) await modulo(org, true);
    const server = await insertServer(
      { name: `Prueba ${Math.random().toString(36).slice(2, 6)}`, baseUrl: `${BASE}/${Math.random().toString(36).slice(2, 8)}`, apiKey: "llave-maestra-0123456789" },
      null
    );
    serverId = server.id;
    const sealed = sealForStorage(LLAVE_INSTANCIA);
    // Solo A tiene dispositivo vinculado; B tiene el módulo pero nunca vinculó.
    await as(A.id, () =>
      getDb().insert(schema.directConnection).values({
        id: newId("directConnection"),
        organizationId: A.id,
        serverId,
        instanceName: "inst-a",
        instanceKeyCipher: sealed.cipher,
        instanceKeyIv: sealed.iv,
        instanceKeyTag: sealed.tag,
        keyVersion: sealed.keyVersion,
        status: "connected",
      })
    );
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
  });

  beforeEach(async () => {
    calls.length = 0;
    next = [];
    await setConexion(A.id, { status: "connected", pausedUntil: null, pauseReason: null, disconnectCount: 0, disconnectWindowStart: null });
    // Cada caso con los límites de fábrica, salvo que diga otra cosa.
    await as(A.id, () => saveDirectLimits(A.id, { limitsEnabled: true, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 }, null));
    // Sin envíos «recientes» de casos anteriores.
    await as(A.id, () =>
      getDb()
        .update(schema.message)
        .set({ status: "failed", queuedUntil: null })
        .where(and(eq(schema.message.organizationId, A.id), eq(schema.message.transport, "directa")))
    );
    resetDirectQueueForTests();
  });

  afterEach(() => resetDirectQueueForTests());

  afterAll(async () => {
    vi.unstubAllGlobals();
    await borrarOrganizaciones([A.id, B.id]);
    await getSystemDb().delete(schema.evolutionServer).where(eq(schema.evolutionServer.id, serverId));
    rmSync(mediaDir, { recursive: true, force: true });
    process.env.MEDIA_DIR = prevMedia;
    resetEnvCacheForTests();
  });

  it("una persona en un chat Automático con la ventana cerrada: «escribiendo…» y el mensaje por el dispositivo", async () => {
    const cv = await chat(A.id, { phone: "5215512340000" });
    const r = await as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "Hola", allowDirect: true }));
    expect(r.queuedUntil ?? null).toBeNull();
    const e = evo();
    expect(e).toHaveLength(2);
    expect(e[0]!.url).toMatch(/\/chat\/sendPresence\/inst-a$/);
    expect(e[0]!.body).toMatchObject({ number: "525512340000", presence: "composing" });
    expect(e[0]!.body.delay as number).toBeGreaterThanOrEqual(1000);
    expect(e[0]!.body.delay as number).toBeLessThanOrEqual(3000);
    expect(e[1]!.url).toMatch(/\/message\/sendText\/inst-a$/);
    expect(e[1]!.body).toEqual({ number: "525512340000", text: "Hola" });
    // Con la llave de la instancia, no la maestra.
    expect(e.every((c) => c.apikey === LLAVE_INSTANCIA)).toBe(true);
    expect(meta()).toHaveLength(0);
    const [m] = await mensajes(A.id, cv);
    expect(m).toMatchObject({ transport: "directa", status: "sent", altMessageId: "EVO2", waMessageId: null, origin: "operator", queuedUntil: null });
    expect(m!.sentAt).not.toBeNull();
  }, 15_000);

  it("la IA nunca sale por el dispositivo, aunque el chat esté en Directa (ventana cerrada = no se envía)", async () => {
    const cv = await chat(A.id, { mode: "directa" });
    await expect(as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "IA", aiGenerated: true, allowDirect: true }))).rejects.toMatchObject({ code: "window_closed" });
    await expect(as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "auto" }))).rejects.toMatchObject({ code: "window_closed" });
    expect(evo()).toHaveLength(0);
  });

  it("modo Meta, sin modo propio (la organización: Meta) o sin dispositivo vinculado: por Meta, como siempre", async () => {
    const abierta = new Date();
    for (const [org, mode] of [[A.id, "meta"], [A.id, null], [B.id, "directa"]] as const) {
      calls.length = 0;
      const cv = await chat(org, { mode, inbound: abierta });
      await as(org, () => sendText({ organizationId: org, conversationId: cv, text: "x", allowDirect: true }));
      expect(evo(), `${org} ${mode}`).toHaveLength(0);
      expect(meta()).toHaveLength(1);
      const [m] = await mensajes(org, cv);
      expect(m!.transport).toBeNull();
    }
  });

  it("sin el módulo, nada cambia aunque el chat esté en Directa", async () => {
    await modulo(A.id, false);
    try {
      const cv = await chat(A.id, { mode: "directa", inbound: new Date() });
      await as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "x", allowDirect: true }));
      expect(evo()).toHaveLength(0);
      expect(meta()).toHaveLength(1);
    } finally {
      await modulo(A.id, true);
    }
  });

  it("«Usar Meta mientras la ventana esté abierta» (de fábrica): con ventana abierta sale por Meta", async () => {
    const cv = await chat(A.id, { mode: "mixta", inbound: new Date() });
    await as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "x", allowDirect: true }));
    expect(evo()).toHaveLength(0);
    expect(meta()).toHaveLength(1);
  });

  it("el 2.º mensaje en menos de 8 s queda «En cola» y sale solo a su hora", async () => {
    const cv = await chat(A.id);
    await as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "uno", allowDirect: true }));
    const antes = Date.now();
    const r = await as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "dos", allowDirect: true }));
    expect(r.queuedUntil).toBeInstanceOf(Date);
    const espera = r.queuedUntil!.getTime() - antes;
    expect(espera).toBeGreaterThan(5_000);
    expect(espera).toBeLessThanOrEqual(8_500);
    expect(evo().filter((c) => c.url.includes("sendText"))).toHaveLength(1);
    let dos = (await mensajes(A.id, cv)).find((m) => m.text === "dos")!;
    expect(dos).toMatchObject({ status: "pending", transport: "directa", altMessageId: null });
    expect(dos.queuedUntil).not.toBeNull();

    // Antes de su hora no sale.
    await as(A.id, () => dispatchQueued(A.id, dos.id, new Date()));
    expect(evo().filter((c) => c.url.includes("sendText"))).toHaveLength(1);
    // A su hora sale una vez, aunque lo intenten dos.
    await Promise.all([
      as(A.id, () => dispatchQueued(A.id, dos.id, r.queuedUntil!)),
      as(A.id, () => dispatchQueued(A.id, dos.id, r.queuedUntil!)),
    ]);
    expect(evo().filter((c) => c.url.includes("sendText"))).toHaveLength(2);
    dos = (await mensajes(A.id, cv)).find((m) => m.text === "dos")!;
    expect(dos).toMatchObject({ status: "sent", queuedUntil: null });
    expect(dos.altMessageId).toMatch(/^EVO/);
  }, 20_000);

  it("con los límites apagados no hay fila", async () => {
    await sinLimites(A.id);
    const cv = await chat(A.id);
    for (const t of ["a", "b", "c"]) {
      const r = await as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: t, allowDirect: true }));
      expect(r.queuedUntil ?? null).toBeNull();
    }
    expect((await mensajes(A.id, cv)).every((m) => m.status === "sent")).toBe(true);
  }, 20_000);

  it("los límites se validan al guardarse", async () => {
    const mal = await as(A.id, () => saveDirectLimits(A.id, { limitsEnabled: true, minIntervalSeconds: -1, perChatPerMinute: 5, perHour: 60 }, null));
    expect(mal.ok).toBe(false);
    const bien = await as(A.id, () => saveDirectLimits(A.id, { limitsEnabled: true, minIntervalSeconds: 20, perChatPerMinute: 3, perHour: 30 }, null));
    expect(bien).toEqual({ ok: true, limits: { limitsEnabled: true, minIntervalSeconds: 20, perChatPerMinute: 3, perHour: 30 } });
  });

  it("dos fallos del dispositivo en un día pausan la directa 24 h; el texto que no salió no se queda en el hilo", async () => {
    await sinLimites(A.id);
    const cv = await chat(A.id);
    next = [{ status: 500, body: { message: "Internal" } }];
    const e1 = await as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "f1", allowDirect: true })).catch((e) => e);
    expect(e1).toBeInstanceOf(SendError);
    expect(e1).toMatchObject({ code: "meta_unavailable" });
    expect(String(e1.message)).not.toMatch(/evolution|no oficial/i);
    expect(await mensajes(A.id, cv)).toHaveLength(0);
    expect((await conexion(A.id)).disconnectCount).toBe(1);
    expect((await conexion(A.id)).pausedUntil).toBeNull();

    next = [{ status: 400, body: { response: { message: ["Connection Closed"] } } }];
    await expect(as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "f2", allowDirect: true }))).rejects.toBeInstanceOf(SendError);
    const c = await conexion(A.id);
    expect(c.pauseReason).toBe("disconnects");
    expect(c.pausedUntil!.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);

    calls.length = 0;
    await expect(as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "f3", allowDirect: true }))).rejects.toMatchObject({
      code: "not_connected",
      message: DIRECT_TEXT.emergencyPause,
    });
    expect(calls).toHaveLength(0);
  }, 20_000);

  it("un número sin WhatsApp no cuenta para el freno", async () => {
    await sinLimites(A.id);
    const cv = await chat(A.id);
    next = [{ status: 400, body: { response: { message: [{ exists: false, jid: "x", number: "52" }] } } }];
    await expect(as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "x", allowDirect: true }))).rejects.toMatchObject({
      code: "meta_error",
    });
    expect((await conexion(A.id)).disconnectCount).toBe(0);
  });

  it("un aviso de bloqueo pausa ya", async () => {
    await sinLimites(A.id);
    const cv = await chat(A.id);
    next = [{ status: 403, body: { message: "account banned" } }];
    await expect(as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "x", allowDirect: true }))).rejects.toBeInstanceOf(SendError);
    expect((await conexion(A.id)).pauseReason).toBe("ban");
  });

  it("dispositivo desconectado: falla claro y no sale por ningún lado", async () => {
    await setConexion(A.id, { status: "disconnected" });
    const cv = await chat(A.id);
    await expect(as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "x", allowDirect: true }))).rejects.toMatchObject({
      code: "not_connected",
      message: DIRECT_TEXT.disconnected,
    });
    expect(calls).toHaveLength(0);
  });

  it("un contacto sin teléfono no se puede mandar por la directa", async () => {
    const cv = await chat(A.id, { phone: null });
    await expect(as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "x", allowDirect: true }))).rejects.toMatchObject({
      code: "meta_error",
    });
    expect(calls).toHaveLength(0);
  });

  it("un chat de prueba del Laboratorio jamás toca nada real", async () => {
    const cv = await chat(A.id, { isTest: true });
    await expect(as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "x", allowDirect: true }))).rejects.toMatchObject({
      code: "sandbox_violation",
    });
    expect(calls).toHaveLength(0);
  });

  it("archivos: la foto sale por el dispositivo en base64; si falla queda en el hilo como fallida", async () => {
    await sinLimites(A.id);
    const cv = await chat(A.id);
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    await as(A.id, () =>
      sendMediaMessage({
        organizationId: A.id,
        conversationId: cv,
        file: { data: png, mimeType: "image/png", fileName: "foto.png" },
        caption: "mira",
        allowDirect: true,
      })
    );
    const media = evo().find((c) => c.url.includes("/message/sendMedia/"))!;
    expect(media.body).toMatchObject({ number: expect.any(String), mediatype: "image", mimetype: "image/png", caption: "mira", fileName: "foto.png", media: png.toString("base64") });
    expect(meta()).toHaveLength(0);

    next = [{ status: 400, body: { message: "invalid media" } }];
    await expect(
      as(A.id, () =>
        sendMediaMessage({ organizationId: A.id, conversationId: cv, file: { data: png, mimeType: "image/png" }, allowDirect: true })
      )
    ).rejects.toMatchObject({ code: "meta_error", messageId: expect.any(String) });
    const ms = await mensajes(A.id, cv);
    expect(ms.map((m) => m.status).sort()).toEqual(["failed", "sent"]);
    // Un archivo rechazado no cuenta para el freno.
    expect((await conexion(A.id)).disconnectCount).toBe(0);
  }, 20_000);

  it("los audios salen como nota de voz", async () => {
    await sinLimites(A.id);
    const cv = await chat(A.id);
    await as(A.id, () =>
      sendMediaMessage({ organizationId: A.id, conversationId: cv, file: { data: Buffer.from("OggS0000"), mimeType: "audio/ogg" }, allowDirect: true })
    );
    expect(evo().some((c) => c.url.includes("/message/sendWhatsAppAudio/"))).toBe(true);
  });

  it("al arrancar: lo «En cola» sale a su hora y lo que quedó a medias se da por fallido sin reenviar", async () => {
    const cv = await chat(A.id);
    const ids = { cola: newId("message"), medias: newId("message") };
    const hace = (ms: number) => new Date(Date.now() - ms);
    await as(A.id, () =>
      getDb().insert(schema.message).values([
        { id: ids.cola, organizationId: A.id, conversationId: cv, direction: "out", type: "text", text: "en cola", status: "pending", transport: "directa", queuedUntil: hace(1000) },
        { id: ids.medias, organizationId: A.id, conversationId: cv, direction: "out", type: "text", text: "a medias", status: "pending", transport: "directa", sentAt: hace(10 * 60_000) },
      ])
    );
    await resumeDirectQueue();
    await vi.waitFor(
      async () => {
        const cola = (await mensajes(A.id, cv)).find((m) => m.id === ids.cola)!;
        expect(cola.status).toBe("sent");
      },
      { timeout: 10_000, interval: 200 }
    );
    const medias = (await mensajes(A.id, cv)).find((m) => m.id === ids.medias)!;
    expect(medias).toMatchObject({ status: "failed", error: DIRECT_TIMEOUT_TEXT });
    expect(evo().filter((c) => c.url.includes("sendText")).map((c) => c.body.text)).toEqual(["en cola"]);
  }, 20_000);

  it("lo de A no se ve desde B (RLS)", async () => {
    const desdeB = await as(B.id, () => getDb().select().from(schema.message).where(eq(schema.message.transport, "directa")));
    expect(desdeB).toHaveLength(0);
  });
});
