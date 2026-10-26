import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { sealForStorage } from "@/server/credentials";
import { insertServer } from "@/server/credentials/direct";
import { hashToken } from "@/server/direct-connection/link";
import { applyModeToAll, countWhatsAppChats } from "@/server/direct-connection/mode";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Conexión directa — «Aplicar a todos los chats» contra Postgres real (la app
 * como `vocero_app`, con RLS):
 *
 * - Cambia TODOS los chats de WhatsApp de la organización (con o sin modo
 *   propio) y no toca los de otros canales ni los de otra organización.
 * - Salir de Meta pide el dispositivo conectado y sin pausa; volver a Meta
 *   siempre se puede.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);
let seq = 0;

describe("conexión directa — aplicar a todos los chats", () => {
  let A: Org;
  let B: Org;
  let serverId: string;

  async function chat(org: string, channel: "whatsapp" | "instagram", connectionMode: "meta" | "directa" | "mixta" | null) {
    const contactId = newId("contact");
    const ident = channel === "whatsapp" ? `5215${String(++seq).padStart(8, "3")}` : `ig:${++seq}`;
    await getSystemDb().insert(schema.contact).values({ id: contactId, organizationId: org, channel, waIdentity: ident, name: `C${seq}` });
    const id = newId("conversation");
    await getSystemDb().insert(schema.conversation).values({ id, organizationId: org, contactId, channel, connectionMode });
    return id;
  }

  const modos = async (org: string) =>
    Object.fromEntries(
      (
        await getSystemDb()
          .select({ id: schema.conversation.id, mode: schema.conversation.connectionMode })
          .from(schema.conversation)
          .where(eq(schema.conversation.organizationId, org))
      ).map((r) => [r.id, r.mode])
    );

  async function estado(status: "connected" | "disconnected", pausedUntil: Date | null = null) {
    await as(A.id, () =>
      getDb().update(schema.directConnection).set({ status, pausedUntil }).where(eq(schema.directConnection.organizationId, A.id))
    );
  }

  beforeAll(async () => {
    A = await crearOrganizacion("Aplicar A");
    B = await crearOrganizacion("Aplicar B");
    const server = await insertServer(
      { name: `Aplicar ${Math.random().toString(36).slice(2, 6)}`, baseUrl: `http://localhost:47999/${Math.random().toString(36).slice(2, 8)}`, apiKey: "llave-maestra-0123456789" },
      null
    );
    serverId = server.id;
    const sealed = sealForStorage("llave-aplicar-0123456789");
    await as(A.id, () =>
      getDb().insert(schema.directConnection).values({
        id: newId("directConnection"),
        organizationId: A.id,
        serverId,
        instanceName: `inst-aplicar-${Math.random().toString(36).slice(2, 6)}`,
        instanceKeyCipher: sealed.cipher,
        instanceKeyIv: sealed.iv,
        instanceKeyTag: sealed.tag,
        keyVersion: sealed.keyVersion,
        webhookTokenHash: hashToken("e".repeat(48)),
        status: "connected",
      })
    );
  });

  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    await getSystemDb().delete(schema.evolutionServer).where(eq(schema.evolutionServer.id, serverId));
  });

  it("cambia todos los de WhatsApp y solo esos, solo de esta organización", async () => {
    const w1 = await chat(A.id, "whatsapp", null);
    const w2 = await chat(A.id, "whatsapp", "meta");
    const w3 = await chat(A.id, "whatsapp", "directa");
    const ig = await chat(A.id, "instagram", null);
    const otra = await chat(B.id, "whatsapp", "meta");

    expect(await as(A.id, () => countWhatsAppChats(A.id))).toBe(3);
    const r = await as(A.id, () => applyModeToAll(A.id, "mixta"));
    expect(r).toEqual({ ok: true, mode: "mixta", changed: 3 });
    const a = await modos(A.id);
    expect([a[w1], a[w2], a[w3], a[ig]]).toEqual(["mixta", "mixta", "mixta", null]);
    expect((await modos(B.id))[otra]).toBe("meta");

    // Los que ya están en ese modo no se vuelven a tocar.
    expect(await as(A.id, () => applyModeToAll(A.id, "mixta"))).toEqual({ ok: true, mode: "mixta", changed: 0 });
  });

  it("sin dispositivo listo no sale de Meta; volver a Meta siempre se puede", async () => {
    await estado("disconnected");
    expect(await as(A.id, () => applyModeToAll(A.id, "directa"))).toEqual({ ok: false, error: "no_device" });
    await estado("connected", new Date(Date.now() + 3600_000));
    expect(await as(A.id, () => applyModeToAll(A.id, "directa"))).toEqual({ ok: false, error: "paused" });
    const r = await as(A.id, () => applyModeToAll(A.id, "meta"));
    expect(r).toMatchObject({ ok: true, changed: 3 });
    expect(Object.values(await modos(A.id)).filter((m) => m === "meta")).toHaveLength(3);
    await estado("connected");
  });
});
