import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scopedMediaAssets } from "@/lib/db/tenant";
import type { DeviceMessage } from "@/lib/direct-inbound";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { sealForStorage } from "@/server/credentials";
import { insertServer } from "@/server/credentials/direct";
import { saveDirectLimits } from "@/server/direct-connection/limits";
import { DirectSendFailure, resetDirectQueueForTests } from "@/server/direct-connection/send";
import { applyDirectStatuses } from "@/server/direct-connection/status";
import { subscribe, type SseEvent } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";
import { listMyChats } from "@/server/mi-numero/chats";
import { ingestNumberMessages } from "@/server/mi-numero/inbound";
import { MiNumeroFailure } from "@/server/mi-numero/numbers";
import { sendFromMyNumber } from "@/server/mi-numero/send";
import { forgetOrgModules } from "@/server/modules";
import { updateOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Mi número (046), PR 5 — Contestar desde Dashfort por el número de una
 * persona, contra Postgres real (RLS) y un servidor falso (`fetch`):
 *
 * - Sale por la instancia de SU número (su llave), nunca por la de la empresa.
 * - Solo su dueño; sin conexión, error claro.
 * - Límites y freno propios: no gastan ni pausan los de la empresa.
 * - El aviso del dispositivo de lo que salió no se ve dos veces.
 * - Los avisos en vivo solo a su dueño; los archivos que salen quedan fuera
 *   de los filtros de siempre.
 * - Las palomitas del número tocan solo sus chats.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const sys = () => getSystemDb();
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

const BASE = "http://localhost:47812";
const LLAVE_EMPRESA = "llave-empresa-0123456789";
const LLAVE_ANA = "llave-ana-0123456789";

type Call = { url: string; body: Record<string, unknown>; apikey: string | null };
const calls: Call[] = [];
let next: { status: number; body: unknown }[] = [];

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const headers = new Headers(init?.headers);
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  calls.push({ url: url.startsWith(BASE) ? url.slice(BASE.length) : `META ${url}`, body, apikey: headers.get("apikey") });
  if (url.includes("/chat/sendPresence/")) return Promise.resolve(Response.json({}));
  const r = next.shift() ?? { status: 201, body: { key: { id: `EVO${calls.length}X${Date.now()}` }, status: "PENDING" } };
  return Promise.resolve(Response.json(r.body, { status: r.status }));
}
const sends = () => calls.filter((c) => !c.url.includes("sendPresence"));

async function crearMiembro(organizationId: string, name: string, role = "asesor"): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@x.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId, userId: id, role });
  return id;
}

let seq = 0;
function msg(phone: string, text: string, opts: { fromMe?: boolean; keyId?: string } = {}): DeviceMessage {
  const keyId = opts.keyId ?? `IN${++seq}${Date.now()}`;
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

async function falla(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (err instanceof MiNumeroFailure || err instanceof DirectSendFailure) return err.code;
    throw err;
  }
}

describe("Mi número — contestar por el número de la persona (PR 5)", () => {
  let A: Org;
  let fer: string;
  let ana: string;
  let luis: string;
  let numAna: string;
  let serverId: string;
  let chatAna: string;
  let mediaDir: string;
  const prevMedia = process.env.MEDIA_DIR;

  const conexion = async (numberId: string | null) =>
    (await sys().select().from(schema.directConnection).where(eq(schema.directConnection.organizationId, A.id))).find(
      (c) => c.directNumberId === numberId
    )!;
  const mensajes = (conversationId: string) =>
    sys().select().from(schema.message).where(eq(schema.message.conversationId, conversationId));

  beforeAll(async () => {
    mediaDir = mkdtempSync(path.join(tmpdir(), "mi-numero-"));
    process.env.MEDIA_DIR = mediaDir;
    resetEnvCacheForTests();
    A = await crearOrganizacion("MiNumero salida A");
    fer = await crearMiembro(A.id, "Fer", "owner");
    ana = await crearMiembro(A.id, "Ana");
    luis = await crearMiembro(A.id, "Luis");
    await updateOrgModules(A.id, { conexionDirecta: true, miNumero: true, miNumeroMax: 3 }, "prueba");
    forgetOrgModules(A.id);
    numAna = newId("directNumber");
    await sys().insert(schema.directNumber).values({ id: numAna, organizationId: A.id, userId: ana, noticeAcceptedAt: new Date() });
    const server = await insertServer(
      { name: `Prueba ${Math.random().toString(36).slice(2, 6)}`, baseUrl: `${BASE}/${Math.random().toString(36).slice(2, 8)}`, apiKey: "llave-maestra-0123456789" },
      null
    );
    serverId = server.id;
    for (const [numberId, instanceName, llave] of [
      [null, "inst-empresa", LLAVE_EMPRESA],
      [numAna, "inst-ana", LLAVE_ANA],
    ] as const) {
      const sealed = sealForStorage(llave);
      await sys().insert(schema.directConnection).values({
        id: newId("directConnection"),
        organizationId: A.id,
        directNumberId: numberId,
        serverId,
        instanceName,
        instanceKeyCipher: sealed.cipher,
        instanceKeyIv: sealed.iv,
        instanceKeyTag: sealed.tag,
        keyVersion: sealed.keyVersion,
        status: "connected",
      });
    }
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    await ingestNumberMessages({ organizationId: A.id, directNumberId: numAna }, [msg("525533330001", "hola Ana")]);
    chatAna = (await as(A.id, () => listMyChats(A.id, ana))).chats[0]!.id;
  });

  beforeEach(async () => {
    calls.length = 0;
    next = [];
    resetDirectQueueForTests();
    await sys()
      .update(schema.directConnection)
      .set({ status: "connected", pausedUntil: null, pauseReason: null, disconnectCount: 0, disconnectWindowStart: null })
      .where(eq(schema.directConnection.organizationId, A.id));
    await as(A.id, () => saveDirectLimits(A.id, { limitsEnabled: true, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 }, null));
    // Sin envíos «recientes» de casos anteriores.
    await sys()
      .update(schema.message)
      .set({ status: "failed", queuedUntil: null })
      .where(and(eq(schema.message.organizationId, A.id), eq(schema.message.transport, "directa"), eq(schema.message.direction, "out")));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    resetDirectQueueForTests();
    await borrarOrganizaciones([A.id]);
    await sys().delete(schema.evolutionServer).where(eq(schema.evolutionServer.id, serverId));
    await sys().delete(schema.user).where(inArray(schema.user.id, [fer, ana, luis]));
    rmSync(mediaDir, { recursive: true, force: true });
    process.env.MEDIA_DIR = prevMedia;
    resetEnvCacheForTests();
  });

  it("sale por SU número (su instancia y su llave), con «escribiendo…»; los avisos solo a Ana", async () => {
    const eventos: SseEvent[] = [];
    const off = subscribe(A.id, (e) => eventos.push(e));
    const r = await as(A.id, () => sendFromMyNumber(A.id, ana, chatAna, { text: "Hola, te mando la cotización" }));
    off();
    expect(r.queuedUntil).toBeNull();
    expect(calls.map((c) => c.url.replace(/^\/[a-z0-9]+/, ""))).toEqual(["/chat/sendPresence/inst-ana", "/message/sendText/inst-ana"]);
    expect(calls.every((c) => c.apikey === LLAVE_ANA)).toBe(true);
    expect(sends()[0]!.body).toEqual({ number: "5215533330001", text: "Hola, te mando la cotización" });
    const out = (await mensajes(chatAna)).find((m) => m.text === "Hola, te mando la cotización")!;
    expect(out).toMatchObject({ direction: "out", status: "sent", transport: "directa", aiGenerated: false });
    expect(eventos.length).toBeGreaterThan(0);
    for (const e of eventos) {
      expect(e.type.startsWith("number.")).toBe(true);
      expect((e as { audience?: string[] }).audience).toEqual([ana]);
    }
  });

  it("solo su dueño; sin conexión o en pausa, error claro y nada sale", async () => {
    expect(await falla(as(A.id, () => sendFromMyNumber(A.id, luis, chatAna, { text: "x" })))).toBe("not_found");
    expect(await falla(as(A.id, () => sendFromMyNumber(A.id, fer, chatAna, { text: "x" })))).toBe("not_found");
    await sys().update(schema.directConnection).set({ status: "disconnected" }).where(eq(schema.directConnection.id, (await conexion(numAna)).id));
    expect(await falla(as(A.id, () => sendFromMyNumber(A.id, ana, chatAna, { text: "x" })))).toBe("not_linked");
    await sys()
      .update(schema.directConnection)
      .set({ status: "connected", pausedUntil: new Date(Date.now() + 3600_000), pauseReason: "disconnects" })
      .where(eq(schema.directConnection.id, (await conexion(numAna)).id));
    expect(await falla(as(A.id, () => sendFromMyNumber(A.id, ana, chatAna, { text: "x" })))).toBe("paused");
    expect(calls).toHaveLength(0);
  });

  it("límites propios: lo que manda Ana no hace esperar a la empresa", async () => {
    await as(A.id, () => sendFromMyNumber(A.id, ana, chatAna, { text: "uno" }));
    const segundo = await as(A.id, () => sendFromMyNumber(A.id, ana, chatAna, { text: "dos" }));
    // El 2.º en 8 s por el mismo número espera su turno.
    expect(segundo.queuedUntil).not.toBeNull();
    // Un chat de la empresa sale ya: los envíos de Ana no cuentan para ella.
    const contactId = newId("contact");
    await sys().insert(schema.contact).values({ id: contactId, organizationId: A.id, waIdentity: "525533330099", phone: "525533330099", name: "Empresa" });
    const cv = newId("conversation");
    await sys().insert(schema.conversation).values({ id: cv, organizationId: A.id, contactId, connectionMode: "directa" });
    calls.length = 0;
    const empresa = await as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "de la empresa", allowDirect: true }));
    expect(empresa.queuedUntil ?? null).toBeNull();
    expect(sends()[0]!.url).toMatch(/\/message\/sendText\/inst-empresa$/);
  });

  it("freno propio: dos fallos del dispositivo de Ana pausan SU número, no el de la empresa", async () => {
    await as(A.id, () => saveDirectLimits(A.id, { limitsEnabled: false, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 }, null));
    next = [
      { status: 500, body: { error: "caido" } },
      { status: 500, body: { error: "caido" } },
    ];
    expect(await falla(as(A.id, () => sendFromMyNumber(A.id, ana, chatAna, { text: "f1" })))).toBe("meta_unavailable");
    expect(await falla(as(A.id, () => sendFromMyNumber(A.id, ana, chatAna, { text: "f2" })))).toBe("meta_unavailable");
    expect((await conexion(numAna)).pausedUntil).not.toBeNull();
    expect((await conexion(null)).pausedUntil).toBeNull();
    // Un texto que no salió no se queda en el hilo (vuelve al cuadro).
    expect((await mensajes(chatAna)).some((m) => m.text === "f1")).toBe(false);
  });

  it("el aviso del dispositivo de lo que acaba de salir no se ve dos veces; lo escrito en el celular sí entra", async () => {
    await as(A.id, () => saveDirectLimits(A.id, { limitsEnabled: false, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 }, null));
    next = [{ status: 201, body: { key: { id: "ECO-ANA-1" }, status: "PENDING" } }];
    await as(A.id, () => sendFromMyNumber(A.id, ana, chatAna, { text: "con eco" }));
    expect(await ingestNumberMessages({ organizationId: A.id, directNumberId: numAna }, [msg("525533330001", "con eco", { fromMe: true, keyId: "ECO-ANA-1" })])).toBe(0);
    expect((await mensajes(chatAna)).filter((m) => m.text === "con eco")).toHaveLength(1);
    expect(await ingestNumberMessages({ organizationId: A.id, directNumberId: numAna }, [msg("525533330001", "desde el cel", { fromMe: true })])).toBe(1);
  });

  it("palomitas del número: solo en sus chats", async () => {
    await as(A.id, () => saveDirectLimits(A.id, { limitsEnabled: false, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 }, null));
    next = [{ status: 201, body: { key: { id: "PAL-ANA-1" }, status: "PENDING" } }];
    await as(A.id, () => sendFromMyNumber(A.id, ana, chatAna, { text: "palomitas" }));
    // Como empresa no toca nada; como el número de Ana, sí.
    expect(await as(A.id, () => applyDirectStatuses(A.id, [{ id: "PAL-ANA-1", status: "delivered", at: null }]))).toBe(0);
    expect(
      await as(A.id, () => applyDirectStatuses(A.id, [{ id: "PAL-ANA-1", status: "read", at: null }], { directNumberId: numAna, audience: [ana] }))
    ).toBe(1);
    expect((await mensajes(chatAna)).find((m) => m.text === "palomitas")!.status).toBe("read");
  });

  it("un archivo sale por su número y queda fuera de los filtros de siempre", async () => {
    await as(A.id, () => saveDirectLimits(A.id, { limitsEnabled: false, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 }, null));
    const r = await as(A.id, () =>
      sendFromMyNumber(A.id, ana, chatAna, { file: { data: Buffer.from("%PDF-1.4 prueba"), mimeType: "application/pdf", fileName: "cotizacion.pdf" } })
    );
    expect(sends()[0]!.url).toMatch(/\/message\/sendMedia\/inst-ana$/);
    const [m] = await sys().select().from(schema.message).where(eq(schema.message.id, r.messageId));
    expect(m!.mediaAssetId).not.toBeNull();
    const visibles = await as(A.id, () =>
      getDb()
        .select({ id: schema.mediaAsset.id })
        .from(schema.mediaAsset)
        .where(scopedMediaAssets(schema.mediaAsset.organizationId, { organizationId: A.id, userId: fer, seesAll: true }, schema.mediaAsset.id, eq(schema.mediaAsset.id, m!.mediaAssetId!)))
    );
    expect(visibles).toHaveLength(0);
  });
});
