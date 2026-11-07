import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { parseDeviceMessages } from "@/lib/direct-inbound";
import { DEFAULT_FILTERS } from "@/lib/inbox-list";
import { ingestDeviceMessages, processDirectPayload } from "@/server/direct-connection/inbound";
import { countConversations, getConversation, listConversations, updateConversation } from "@/server/inbox/queries";
import { ensureAssetAvailable } from "@/server/whatsapp/media";
import { runAgentTurn } from "@/server/ai/pipeline";
import { forgetOrgModules } from "@/server/modules";
import { sendText, sendMediaMessage, SendError } from "@/server/inbox/send";
import { assignContacts } from "@/server/assignment/assign";
import { createTag, setContactTags } from "@/server/tags/tags";
import { audienceConditions } from "@/server/campaigns/audience";
import { crearOrganizacion, borrarOrganizaciones } from "./fixtures";
import { sealForStorage } from "@/server/credentials";
import { insertServer } from "@/server/credentials/direct";
import { hashToken } from "@/server/direct-connection/link";
import { saveDirectLimits } from "@/server/direct-connection/limits";
import { resetDirectQueueForTests } from "@/server/direct-connection/send";

const jid = "120363000000000000@g.us";
const as = <T>(org: string, f: () => Promise<T>) => runWithOrganization(org, f);
const packet = (id: string, fromMe = false) => parseDeviceMessages({
  key: { id, remoteJid: jid, participant: "5215512345678@s.whatsapp.net", fromMe },
  pushName: "Ana", groupName: "Ventas", message: { conversation: "Hola grupo" }, messageTimestamp: 1794000000,
});

describe("grupos — ingesta, salida y aislamiento", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: typeof A;
  let cv: string;
  let ct: string;
  let serverId: string;
  const advisor = newId("user");
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const owner = () => ({ organizationId: A.id, userId: "owner", seesAll: true });
  beforeAll(async () => {
    A = await crearOrganizacion("GruposA"); B = await crearOrganizacion("GruposB");
    await getSystemDb().insert(schema.user).values({ id: advisor, name: "Asesor grupos", email: `${advisor}@groups.test` });
    await getSystemDb().insert(schema.member).values({ id: newId("member"), organizationId: A.id, userId: advisor, role: "member" });
    for (const org of [A, B]) {
      await getSystemDb().insert(schema.organizationModule).values({ organizationId: org.id, conexionDirecta: true });
      forgetOrgModules(org.id);
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
      return Response.json({ key: { id: "SENT-GROUP" } });
    }));
    const server = await insertServer({ name: "Grupos test", baseUrl: "http://localhost:47813", apiKey: "test-key-groups-123456789" }, null);
    serverId = server.id;
    const sealed = sealForStorage("test-instance-key-groups-123456789");
    await as(A.id, async () => {
      await getDb().insert(schema.directConnection).values({
        id: newId("directConnection"), organizationId: A.id, serverId, instanceName: "groups-test",
        instanceKeyCipher: sealed.cipher, instanceKeyIv: sealed.iv, instanceKeyTag: sealed.tag,
        keyVersion: sealed.keyVersion, webhookTokenHash: hashToken("groups-test-token"), status: "connected",
      });
      await saveDirectLimits(A.id, { limitsEnabled: false, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 }, null);
    });
  });
  afterAll(async () => {
    resetDirectQueueForTests(); vi.unstubAllGlobals();
    await borrarOrganizaciones([A?.id, B?.id].filter(Boolean));
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, advisor));
    if (serverId) await getSystemDb().delete(schema.evolutionServer).where(eq(schema.evolutionServer.id, serverId));
  });
  it("recibe grupos también en híbrido, deduplica y no crea leads ni agenda IA", async () => {
    expect(await ingestDeviceMessages(A.id, packet("IN-GROUP"), { strict: true })).toBe(1);
    await processDirectPayload({ organizationId: A.id, directNumberId: null, messages: packet("IN-GROUP") });
    await as(A.id, async () => {
      const [contact] = await getDb().select().from(schema.contact).where(eq(schema.contact.waGroupJid, jid));
      ct = contact!.id;
      expect(contact).toMatchObject({ name: "Ventas", phone: null, waUserId: null });
      const [conversation] = await getDb().select().from(schema.conversation).where(eq(schema.conversation.contactId, ct));
      cv = conversation!.id;
      expect(conversation).toMatchObject({ aiEnabled: false, connectionMode: "directa", unreadCount: 1 });
      const messages = await getDb().select().from(schema.message).where(eq(schema.message.conversationId, cv));
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ groupSender: "Ana", groupSenderId: "5215512345678@s.whatsapp.net" });
      expect(await getDb().select().from(schema.lead).where(eq(schema.lead.contactId, ct))).toHaveLength(0);
    });
  });
  it("Grupos respeta vista, búsqueda y no leídos; no aparece en clientes ni campañas", async () => {
    await as(A.id, async () => {
      expect(await listConversations(owner())).toHaveLength(0);
      expect(await listConversations(owner(), undefined, { kind: "all" }, "campaigns")).toHaveLength(0);
      const groups = await listConversations(owner(), undefined, { kind: "all" }, "groups");
      expect(groups).toHaveLength(1); expect(groups[0]).toMatchObject({ groupJid: jid, windowOpen: true, aiAvailable: false });
      expect(await countConversations(owner(), { ...DEFAULT_FILTERS, q: "ventas" })).toMatchObject({ groupsEnabled: true, groups: 1, groupUnread: 1 });
      expect(await countConversations(owner(), { ...DEFAULT_FILTERS, q: "desconocido" })).toMatchObject({ groups: 0 });
      await updateConversation(owner(), cv, { markRead: true, aiEnabled: true, reactivate: true });
      expect((await getConversation(owner(), cv))?.conversation).toMatchObject({ unreadCount: 0, aiEnabled: false });
    });
  });
  it("un asesor no asignado y otra empresa no ven el grupo; RLS impide escribir sobre él", async () => {
    await as(A.id, async () => {
      expect(await getConversation({ ...owner(), seesAll: false, userId: "other" }, cv)).toBeNull();
    });
    await as(B.id, async () => {
      expect(await getConversation({ organizationId: B.id, seesAll: true, userId: "owner" }, cv)).toBeNull();
      expect(await getDb().select().from(schema.contact).where(eq(schema.contact.id, ct))).toHaveLength(0);
      await expect(getDb().insert(schema.message).values({ id: newId("message"), organizationId: A.id, conversationId: cv, direction: "in" })).rejects.toThrow();
    });
  });
  it("asignación y etiquetas usan los mismos permisos y filtros", async () => {
    await as(A.id, async () => {
      expect(await assignContacts({ organizationId: A.id, contactIds: [ct], toUserId: advisor, actorUserId: null, source: "manual" })).toMatchObject({ ok: true });
      const access = { ...owner(), seesAll: false, userId: advisor };
      expect(await getConversation(access, cv)).not.toBeNull();
      const tag = await createTag(A.id, { name: "Ventas grupo" });
      await setContactTags(A.id, ct, [tag.id]);
      expect(await countConversations(access, { ...DEFAULT_FILTERS, tag: tag.id, owner: "mine" })).toMatchObject({ groups: 1 });
      expect((await countConversations(access, DEFAULT_FILTERS)).tags).toContainEqual([tag.id, tag.name]);
    });
  });
  it("solo salida manual directa: nunca Meta ni campañas, incluso con consentimiento", async () => {
    await as(A.id, async () => {
      await expect(sendText({ organizationId: A.id, conversationId: cv, text: "No IA", aiGenerated: true })).rejects.toBeInstanceOf(SendError);
      await sendText({ organizationId: A.id, conversationId: cv, text: "Manual", allowDirect: true });
      expect(calls.find((c) => c.url.includes("message/sendText"))?.body).toMatchObject({ number: jid, text: "Manual" });
      expect(calls.some((c) => c.url.includes("graph.facebook.com"))).toBe(false);
      await getDb().update(schema.contact).set({ waConsent: "opt_in" }).where(eq(schema.contact.id, ct));
      const eligible = await getDb().select().from(schema.contact).where(and(...audienceConditions({}), eq(schema.contact.id, ct)));
      expect(eligible).toHaveLength(0);
    });
    await ingestDeviceMessages(A.id, packet("SENT-GROUP", true), { strict: true });
    const rows = await as(A.id, () => getDb().select().from(schema.message).where(eq(schema.message.conversationId, cv)));
    expect(rows).toHaveLength(2);
  });
  it("envía imágenes y documentos por el compositor y conserva sus archivos", async () => {
    // IDs distintos, como los que devuelve Evolution para cada envío.
    let serial = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
      return Response.json({ key: { id: `FILE-GROUP-${++serial}` } });
    }));
    await as(A.id, async () => {
      for (const mimeType of ["image/png", "application/pdf"]) {
        await sendMediaMessage({ organizationId: A.id, conversationId: cv, allowDirect: true,
          file: { data: Buffer.from("group attachment"), mimeType, fileName: mimeType === "image/png" ? "grupo.png" : "grupo.pdf" }, caption: "Para el grupo" });
      }
      const mediaCalls = calls.filter((c) => c.url.includes("message/sendMedia"));
      expect(mediaCalls).toHaveLength(2);
      expect(mediaCalls.map((c) => c.body)).toEqual(expect.arrayContaining([
        expect.objectContaining({ number: jid, mediatype: "image" }),
        expect.objectContaining({ number: jid, mediatype: "document" }),
      ]));
    });
  });
  it("la bandeja durable conserva adjuntos y obtiene el título de Evolution", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push({ url: String(url), body: {} });
      if (String(url).includes("group/findGroupInfos")) return Response.json({ subject: "Equipo nuevo" });
      return Response.json({ base64: Buffer.from("archivo de grupo").toString("base64"), mimetype: "application/octet-stream" });
    }));
    for (const [i, field] of ["imageMessage", "audioMessage", "documentMessage"].entries()) {
      const messages = parseDeviceMessages({ key: { id: `IN-FILE-${i}`, remoteJid: "120363000000000001@g.us", participant: "5215512345678@s.whatsapp.net" },
        pushName: "Luis", message: { [field]: { mimetype: "application/octet-stream", fileName: "grupo.bin" } } });
      await processDirectPayload({ organizationId: A.id, directNumberId: null, messages });
    }
    await as(A.id, async () => {
      const [contact] = await getDb().select().from(schema.contact).where(eq(schema.contact.waGroupJid, "120363000000000001@g.us"));
      expect(contact?.name).toBe("Equipo nuevo");
      const [conversation] = await getDb().select().from(schema.conversation).where(eq(schema.conversation.contactId, contact!.id));
      const rows = await getDb().select().from(schema.message).where(eq(schema.message.conversationId, conversation!.id));
      expect(rows.map((m) => m.type).sort()).toEqual(["audio", "document", "image"]);
      for (const m of rows) {
        expect(m.groupSender).toBe("Luis");
        expect(await ensureAssetAvailable(A.id, m.mediaAssetId!)).toMatchObject({ fetchStatus: "available" });
      }
    });
  });
  it("un turno antiguo no llama al modelo aunque alguien haya activado aiEnabled", async () => {
    await as(A.id, async () => {
      await getDb().update(schema.conversation).set({ aiEnabled: true }).where(eq(schema.conversation.id, cv));
      const before = calls.length;
      const oldToken = process.env.OPENROUTER_API_TOKEN;
      process.env.OPENROUTER_API_TOKEN = "mock-group-ai-test";
      try { await runAgentTurn(cv); } finally {
        if (oldToken === undefined) delete process.env.OPENROUTER_API_TOKEN;
        else process.env.OPENROUTER_API_TOKEN = oldToken;
      }
      expect(calls).toHaveLength(before);
    });
  });
  it("al apagar la conexión directa no expone chip ni listado de grupos", async () => {
    await getSystemDb().update(schema.organizationModule).set({ conexionDirecta: false }).where(eq(schema.organizationModule.organizationId, A.id));
    forgetOrgModules(A.id);
    await as(A.id, async () => {
      expect(await countConversations(owner(), DEFAULT_FILTERS)).toMatchObject({ groupsEnabled: false, groups: 0, groupUnread: 0 });
      expect(await listConversations(owner(), undefined, { kind: "all" }, "groups")).toHaveLength(0);
      await expect(sendText({ organizationId: A.id, conversationId: cv, text: "No", allowDirect: true })).rejects.toBeInstanceOf(SendError);
    });
  });
});
