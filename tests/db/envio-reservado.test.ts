import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { processMessagesValue } from "@/server/inbox/ingest";
import type { WebhookValue } from "@/server/inbox/webhook";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Auditoría DF-13 y DF-18 contra Postgres real.
 *
 * DF-13: el saliente se registra ANTES de llamar a Meta. Aceptado → con su ID;
 * rechazado → la reserva se borra (texto) o queda fallida (archivo); sin
 * respuesta a tiempo → «no se sabe si llegó», nunca se reenvía; lo que un
 * reinicio dejó a medias lo cierra la recuperación.
 *
 * DF-18: un mensaje que llega tarde no hace retroceder la fecha del chat.
 */

const graph = vi.hoisted(() => ({ mode: "ok" as "ok" | "reject" | "timeout", calls: 0 }));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return {
    ...original,
    graphRequest: vi.fn(async () => {
      graph.calls++;
      if (graph.mode === "timeout") throw new original.MetaApiError("Meta no respondió en 20 s", { status: 0, timedOut: true });
      if (graph.mode === "reject") throw new original.MetaApiError("(#131026) Mensaje no entregable", { status: 400, code: 131026 });
      return { messages: [{ id: `wamid.reservado.${Math.random().toString(36).slice(2)}` }] };
    }),
  };
});

vi.mock("@/server/whatsapp/media", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/whatsapp/media")>();
  return { ...original, uploadGraphMedia: vi.fn(async () => "media-prueba") };
});

// Después del mock: el envío ya usa el Graph falso.
const { sendMediaMessage, sendText, UNCONFIRMED_SEND_TEXT } = await import("@/server/inbox/send");
const { recoverInterruptedSends, INTERRUPTED_AFTER_MS } = await import("@/server/inbox/interrupted");

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

describe("DF-13: el saliente se registra antes de llamar a Meta", () => {
  let A: Org;
  let mediaDir: string;
  const prevMedia = process.env.MEDIA_DIR;

  async function chat(org: string) {
    return as(org, async () => {
      const contactId = newId("contact");
      const phone = `52155${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
      await getDb().insert(schema.contact).values({ id: contactId, organizationId: org, waIdentity: phone, phone, name: "Cliente" });
      const id = newId("conversation");
      await getDb().insert(schema.conversation).values({ id, organizationId: org, contactId, lastInboundAt: new Date() });
      return id;
    });
  }
  const mensajes = (org: string, cv: string) =>
    as(org, () => getDb().select().from(schema.message).where(and(eq(schema.message.organizationId, org), eq(schema.message.conversationId, cv))));

  beforeAll(async () => {
    mediaDir = mkdtempSync(path.join(tmpdir(), "df13-"));
    process.env.MEDIA_DIR = mediaDir;
    resetEnvCacheForTests();
    A = await crearOrganizacion("DF13 A");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    rmSync(mediaDir, { recursive: true, force: true });
    if (prevMedia === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = prevMedia;
    resetEnvCacheForTests();
  });
  beforeEach(() => {
    graph.mode = "ok";
    graph.calls = 0;
  });

  it("aceptado: queda un solo mensaje, con el ID de Meta y en espera de acuses", async () => {
    const cv = await chat(A.id);
    const r = await as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "Hola" }));
    const filas = await mensajes(A.id, cv);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: r.messageId, status: "pending", direction: "out", text: "Hola" });
    expect(filas[0]!.waMessageId).toMatch(/^wamid\.reservado\./);
  });

  it("texto rechazado por Meta: la reserva se borra (como antes, el texto sigue en la caja)", async () => {
    const cv = await chat(A.id);
    graph.mode = "reject";
    await expect(as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "x" }))).rejects.toMatchObject({ code: "meta_error" });
    expect(await mensajes(A.id, cv)).toHaveLength(0);
  });

  it("Meta no respondió a tiempo: queda «no se sabe si llegó» (no se borra ni se reenvía)", async () => {
    const cv = await chat(A.id);
    graph.mode = "timeout";
    const err = await as(A.id, () => sendText({ organizationId: A.id, conversationId: cv, text: "¿llegó?" })).catch((e) => e);
    expect(err).toMatchObject({ code: "meta_unavailable", timedOut: true });
    const filas = await mensajes(A.id, cv);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: err.messageId, status: "failed", error: UNCONFIRMED_SEND_TEXT, waMessageId: null });
    expect(graph.calls).toBe(1);
  });

  it("archivo rechazado: queda fallido en el hilo con el archivo; aceptado: pendiente con su ID", async () => {
    const cv = await chat(A.id);
    const file = { data: Buffer.from("%PDF-1.4 prueba"), mimeType: "application/pdf", fileName: "a.pdf" };
    graph.mode = "reject";
    const err = await as(A.id, () => sendMediaMessage({ organizationId: A.id, conversationId: cv, file })).catch((e) => e);
    expect(err.messageId).toBeTruthy();
    graph.mode = "ok";
    const ok = await as(A.id, () => sendMediaMessage({ organizationId: A.id, conversationId: cv, file }));
    const filas = await mensajes(A.id, cv);
    expect(filas.find((m) => m.id === err.messageId)).toMatchObject({ status: "failed", waMessageId: null });
    const bien = filas.find((m) => m.id === ok.messageId);
    expect(bien?.status).toBe("pending");
    expect(bien?.waMessageId).toMatch(/^wamid\./);
    expect(bien?.mediaAssetId).toBeTruthy();
  });

  it("reserva que un reinicio dejó a medias: pasa a «no se sabe si llegó» tras 10 min (la reciente no se toca)", async () => {
    const cv = await chat(A.id);
    const vieja = newId("message");
    const nueva = newId("message");
    await getSystemDb().insert(schema.message).values([
      { id: vieja, organizationId: A.id, conversationId: cv, direction: "out", type: "text", text: "a medias", status: "pending", createdAt: new Date(Date.now() - INTERRUPTED_AFTER_MS - 60_000) },
      { id: nueva, organizationId: A.id, conversationId: cv, direction: "out", type: "text", text: "saliendo", status: "pending" },
    ]);
    expect(await recoverInterruptedSends()).toBeGreaterThanOrEqual(1);
    const filas = await mensajes(A.id, cv);
    expect(filas.find((m) => m.id === vieja)).toMatchObject({ status: "failed", error: UNCONFIRMED_SEND_TEXT });
    expect(filas.find((m) => m.id === nueva)?.status).toBe("pending");
  });
});

describe("DF-18: las fechas del chat solo avanzan", () => {
  let A: Org;
  beforeAll(async () => {
    A = await crearOrganizacion("DF18 A");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
  });

  const entrante = (from: string, segundos: number, texto: string): WebhookValue =>
    ({
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "5215500000000", phone_number_id: A.phoneNumberId },
      contacts: [{ profile: { name: "Cliente" }, wa_id: from }],
      messages: [{ from, id: `wamid.df18.${Math.random().toString(36).slice(2)}`, timestamp: String(segundos), type: "text", text: { body: texto } }],
    }) as WebhookValue;

  it("el mensaje reciente llega primero y uno viejo después: la fecha y la ventana se quedan en el reciente", async () => {
    const tel = "5215533330001";
    const t2 = Math.floor(Date.now() / 1000);
    const t1 = t2 - 3 * 60 * 60;
    await processMessagesValue(entrante(tel, t2, "lo más nuevo"));
    await processMessagesValue(entrante(tel, t1, "esto se escribió antes"));
    const [c] = await getSystemDb().select().from(schema.conversation).where(eq(schema.conversation.organizationId, A.id));
    expect(c!.lastInboundAt!.getTime()).toBe(t2 * 1000);
    expect(c!.lastMessageAt!.getTime()).toBe(t2 * 1000);
    // Los dos mensajes entraron (nada se pierde) y cuentan como no leídos.
    const ms = await getSystemDb().select().from(schema.message).where(eq(schema.message.conversationId, c!.id));
    expect(ms).toHaveLength(2);
    expect(c!.unreadCount).toBe(2);
  });
});
