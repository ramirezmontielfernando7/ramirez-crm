import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/mobile/session/route";
import { GET as history, POST as send } from "@/app/api/conversations/[id]/messages/route";
import { PUT as react } from "@/app/api/conversations/[id]/messages/[messageId]/reaction/route";
import { POST as mockGraph } from "@/app/api/dev/wa-mock/graph/[...path]/route";
import { getAuth } from "@/lib/auth";
import { resetEnvCacheForTests } from "@/lib/env";
import { getSql, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { subscribe, type SseEvent } from "@/server/events/bus";
import { getWaMockState } from "@/server/dev/wa-mock-state";
import { processMessagesValue } from "@/server/inbox/ingest";
import { forgetOrgStatus } from "@/server/platform-admin/org-status";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

const callContext = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => callContext.headers }));

const db = getSystemDb();
const tokenHeaders = new Map<string, Headers>();
const users = Object.fromEntries(["operator", "other", "foreign"].map((key) => [key, newId("user")]));
const orgs: Awaited<ReturnType<typeof crearOrganizacion>>[] = [];
const chats: Awaited<ReturnType<typeof fixtureChat>>[] = [];
const phone = "15550101137";
const base = new URL(process.env.APP_BASE_URL!).origin;
const now = Math.floor(Date.now() / 1000);
const targetText = "z".repeat(140);

async function fixtureChat(organizationId: string, userId: string, phoneNumberId: string, identity: string, isTest = false) {
  const contactId = newId("contact");
  const id = newId("conversation");
  const messageId = newId("message");
  const waId = "wamid.fixture." + messageId;
  await db.insert(schema.contact).values({ id: contactId, organizationId, waIdentity: identity, phone: identity, name: "Contacto ficticio", assignedUserId: userId });
  await db.insert(schema.conversation).values({
    id, organizationId, contactId, isTest, waPhoneNumberId: phoneNumberId,
    lastInboundAt: new Date(), lastMessageAt: new Date(), unreadCount: 3,
  });
  await db.insert(schema.message).values({ id: messageId, organizationId, conversationId: id, waMessageId: waId, direction: "in", text: targetText });
  return { id, messageId, waId, phoneNumberId, identity, organizationId };
}

function request(path: string, method: string, user?: string, payload?: object) {
  const headers = new Headers(user ? tokenHeaders.get(user) : undefined);
  if (payload) headers.set("content-type", "application/json");
  callContext.headers = headers;
  return new Request(base + path, { method, headers, ...(payload ? { body: JSON.stringify(payload) } : {}) });
}
const url = (id: string) => `/api/conversations/${id}/messages`;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, user: string | undefined, data: object) => send(request(url(id), "POST", user, data), params(id));
const put = (id: string, messageId: string, user: string | undefined, emoji: string) =>
  react(request(url(id) + `/${messageId}/reaction`, "PUT", user, { emoji }), { params: Promise.resolve({ id, messageId }) });
const read = (id: string, user: string) => history(request(url(id), "GET", user), params(id));

function inbound(chat: typeof chats[number], eventId: string, emoji: string, opts: { target?: string; time?: number; from?: string; line?: string } = {}) {
  return processMessagesValue({
    metadata: { phone_number_id: opts.line ?? chat.phoneNumberId },
    messages: [{
      from: opts.from ?? chat.identity, id: eventId, type: "reaction", timestamp: String(opts.time ?? now),
      reaction: { message_id: opts.target ?? chat.waId, emoji },
    }],
  });
}

beforeAll(async () => {
  vi.stubEnv("WA_MOCK_ENABLED", "true");
  // La prueba reenvía solo lo que apunta a este origen hacia el handler real de wa-mock.
  vi.stubEnv("META_GRAPH_BASE_URL", base);
  resetEnvCacheForTests();
  const [role] = await getSql()`select current_user as name, rolbypassrls, rolsuper from pg_roles where rolname=current_user`;
  expect(role).toEqual({ name: "vocero_app", rolbypassrls: false, rolsuper: false });
  for (const name of ["Anotaciones A", "Anotaciones B"]) orgs.push(await crearOrganizacion(name));
  const password = randomBytes(24).toString("hex");
  const hash = await (await getAuth().$context).password.hash(password);
  for (const [index, [key, id]] of Object.entries(users).entries()) {
    const email = `${id}@fixture.test`;
    await db.insert(schema.user).values({ id, name: key, email, emailVerified: true });
    await db.insert(schema.member).values({ id: newId("member"), organizationId: orgs[key === "foreign" ? 1 : 0]!.id, userId: id, role: "asesor" });
    await db.insert(schema.account).values({ id: newId("account"), userId: id, accountId: id, providerId: "credential", password: hash });
    const response = await login(new Request(base + "/api/mobile/session", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0." + (index + 2) },
      body: JSON.stringify({ email, password }),
    }));
    expect(response.status).toBe(200);
    tokenHeaders.set(key, new Headers({ authorization: "Bearer " + (await response.json()).token }));
  }
  const a = orgs[0]!, b = orgs[1]!;
  chats.push(
    await fixtureChat(a.id, users.operator!, a.phoneNumberId, phone),
    await fixtureChat(a.id, users.other!, a.phoneNumberId, "15550101138"),
    await fixtureChat(b.id, users.foreign!, b.phoneNumberId, "15550101139"),
    await fixtureChat(a.id, users.operator!, a.phoneNumberId, "15550101140", true),
  );
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.origin !== base) throw new Error("La prueba solo permite wa-mock local");
    const path = target.pathname.split("/").filter(Boolean);
    return mockGraph(new Request(target, init), { params: Promise.resolve({ path }) });
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await borrarOrganizaciones(orgs.map(({ id }) => id));
  await db.delete(schema.user).where(inArray(schema.user.id, Object.values(users)));
});

it("persists context, caps previews, and does not expose quotes from other chats", async () => {
  const chat = chats[0]!;
  const ctx = (id: string, target: string) => ({
    from: chat.identity, id: chat.waId + id, type: "text",
    timestamp: String(now), text: { body: "Respuesta ficticia" }, context: { id: target },
  });
  await processMessagesValue({ metadata: { phone_number_id: chat.phoneNumberId }, messages: [
    ctx(".quote", chat.waId), ctx(".alien", chats[1]!.waId), ctx(".foreign", chats[2]!.waId),
  ] });
  const stored = await db.select().from(schema.message).where(eq(schema.message.waMessageId, chat.waId + ".quote"));
  expect(stored[0]?.replyToWaMessageId).toBe(chat.waId);
  const result = await read(chat.id, "operator");
  expect(result.status).toBe(200);
  const { messages } = await result.json();
  expect(messages.find((m: { id: string }) => m.id === stored[0]!.id).replyTo).toEqual({
    id: chat.messageId, direction: "in", type: "text", preview: "z".repeat(120),
  });
  expect(messages.filter((m: { replyTo: unknown }) => m.replyTo)).toHaveLength(1);
  expect(messages.every((m: { reactions: unknown }) => Array.isArray(m.reactions))).toBe(true);
});

it("upserts, removes and deduplicates inbound reactions without touching chat state or push", async () => {
  const chat = chats[0]!;
  const row = async () => (await db.select().from(schema.conversation).where(eq(schema.conversation.id, chat.id)))[0];
  const count = () => db.select({ id: schema.message.id }).from(schema.message).where(eq(schema.message.conversationId, chat.id));
  const changes: SseEvent[] = [];
  const off = subscribe(chat.organizationId, (event) => changes.push(event));
  const prefix = chat.waId + ".react.";
  try {
    const before = await row(), messages = await count(), outbound = getWaMockState().outbox.length;
    await inbound(chat, prefix + "1", "👍");
    await inbound(chat, prefix + "2", "❤️");
    await inbound(chat, prefix + "1", "👍");
    let visible = (await (await read(chat.id, "operator")).json()).messages;
    expect(visible.find((m: { id: string }) => m.id === chat.messageId).reactions).toEqual([{ direction: "in", emoji: "❤️" }]);
    await inbound(chat, prefix + "3", "");
    await inbound(chat, prefix + "2", "❤️");
    await inbound(chat, prefix + "old", "😂", { time: now - 60 });
    await inbound(chat, prefix + "unknown", "😂", { target: "wamid.unknown" });
    await inbound(chat, prefix + "impostor", "😂", { from: chats[1]!.identity });
    await inbound(chat, prefix + "foreign", "😂", { line: orgs[1]!.phoneNumberId });
    await inbound(chats[3]!, prefix + "test", "😂");
    await db.update(schema.organization).set({ status: "suspended" }).where(eq(schema.organization.id, chat.organizationId));
    forgetOrgStatus(chat.organizationId);
    await inbound(chat, prefix + "suspended", "😂");
    await db.update(schema.organization).set({ status: "active" }).where(eq(schema.organization.id, chat.organizationId));
    forgetOrgStatus(chat.organizationId);
    visible = (await (await read(chat.id, "operator")).json()).messages;
    expect(visible.find((m: { id: string }) => m.id === chat.messageId).reactions).toEqual([]);
    expect(await db.select().from(schema.messageReaction).where(eq(schema.messageReaction.messageId, chats[3]!.messageId))).toEqual([]);
    expect(changes.map(({ type }) => type)).toEqual(["message.reaction", "message.reaction", "message.reaction"]);
    expect(await count()).toEqual(messages);
    expect(await row()).toEqual(before);
    expect(getWaMockState().outbox).toHaveLength(outbound);
  } finally { off(); }
});

it("sends a scoped quote and each reaction once through the actual wa-mock handler", async () => {
  const chat = chats[0]!;
  const start = getWaMockState().outbox.length;
  const sent = await post(chat.id, "operator", { text: "Salida ficticia", replyToMessageId: chat.messageId });
  expect(sent.status).toBe(200);
  expect((await sent.json()).replyApplied).toBe(true);
  expect((await put(chat.id, chat.messageId, "operator", "👍")).status).toBe(200);
  expect(await (await put(chat.id, chat.messageId, "operator", "👍")).json()).toEqual({ ok: true, changed: false });
  const entries = getWaMockState().outbox.slice(start);
  expect(entries).toHaveLength(2);
  expect(entries[0]?.body).toMatchObject({ type: "text", context: { message_id: chat.waId } });
  expect(entries[1]?.body).toMatchObject({ type: "reaction", reaction: { message_id: chat.waId, emoji: "👍" } });
  const rows = (await (await read(chat.id, "operator")).json()).messages;
  expect(rows.find((m: { direction: string }) => m.direction === "out").replyTo.id).toBe(chat.messageId);
  expect(rows.find((m: { id: string }) => m.id === chat.messageId).reactions).toEqual([{ direction: "out", emoji: "👍" }]);
  expect((await put(chat.id, chat.messageId, "operator", "")).status).toBe(200);
  expect(getWaMockState().outbox.at(-1)?.body).toMatchObject({ type: "reaction", reaction: { message_id: chat.waId, emoji: "" } });
});

it("enforces Bearer access, target scope, valid emoji, the test sandbox and the 24-hour window", async () => {
  const chat = chats[0]!;
  const n = getWaMockState().outbox.length;
  for (const [user, status] of [[undefined, 401], ["other", 404], ["foreign", 404]] as const) {
    expect((await post(chat.id, user, { text: "Prueba", replyToMessageId: chat.messageId })).status).toBe(status);
    expect((await put(chat.id, chat.messageId, user, "👍")).status).toBe(status);
  }
  for (const alien of chats.slice(1, 3)) {
    expect((await post(chat.id, "operator", { text: "Prueba", replyToMessageId: alien.messageId })).status).toBe(404);
    expect((await put(chat.id, alien.messageId, "operator", "👍")).status).toBe(404);
  }
  expect((await put(chat.id, chat.messageId, "operator", "👍👍")).status).toBe(422);
  expect([403, 404]).toContain((await put(chats[3]!.id, chats[3]!.messageId, "operator", "👍")).status);
  await db.update(schema.conversation).set({ lastInboundAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(schema.conversation.id, chat.id));
  for (const result of [
    await post(chat.id, "operator", { text: "Prueba", replyToMessageId: chat.messageId }),
    await put(chat.id, chat.messageId, "operator", "👍"),
  ]) {
    expect(result.status).toBe(409);
    expect((await result.json()).error.code).toBe("window_closed");
  }
  expect(getWaMockState().outbox).toHaveLength(n);
});
