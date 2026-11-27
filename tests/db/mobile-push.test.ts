import { generateKeyPairSync, randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { POST as register } from "@/app/api/mobile/push/register/route";
import { POST as unregister } from "@/app/api/mobile/push/unregister/route";
import { POST as login } from "@/app/api/mobile/session/route";
import { POST as revoke } from "@/app/api/mobile/session/revoke/route";
import { getAuth } from "@/lib/auth";
import { getDb, getSql, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { middleware } from "@/middleware";
import { openFromStorage } from "@/server/credentials";
import { ingestInboundMessage } from "@/server/inbox/ingest";
import { deliverMobilePush } from "@/server/mobile-push/delivery";
import { purgeOrgPushDevices, retentionMs } from "@/server/mobile-push/devices";
import { forgetOrgStatus } from "@/server/platform-admin/org-status";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

const context = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => context.headers }));
const db = getSystemDb();
const base = process.env.APP_BASE_URL!;
const users = { owner: newId("user"), advisor: newId("user"), other: newId("user"), outside: newId("user") };
const orgs: string[] = [];
const tokens = Object.fromEntries(Object.keys(users).map((key) => [key, "fixture-" + key + "-fcm-device"]));
const credentials = {} as Record<keyof typeof users, Headers>;
const contactId = newId("contact");
const conversationId = newId("conversation");
const messageId = newId("message");
const job = () => ({ organizationId: orgs[0]!, conversationId, messageId });
const phone = "15550100126";
const route = (name: string) => "/api/mobile/push/" + name;

function req(path: string, headers: HeadersInit = {}, body: object = {}) {
  const metadata = new Headers(headers);
  metadata.set("content-type", "application/json");
  return new NextRequest(base + path, { method: "POST", headers: metadata, body: JSON.stringify(body) });
}

async function call(path: "register" | "unregister", who: keyof typeof users | null, body: object) {
  const request = req(route(path), who ? credentials[who] : {}, body);
  context.headers = request.headers;
  const check = middleware(request);
  expect(check.status).toBe(200);
  return (path === "register" ? register : unregister)(request);
}

let httpMode: "sent" | "offline" = "sent";
const sentBodies: unknown[] = [];
const http = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.href === "https://oauth2.googleapis.com/token")
    return Response.json({ access_token: "fixture-oauth", expires_in: 3600 });
  if (url.origin === "https://fcm.googleapis.com") {
    sentBodies.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: httpMode === "sent" ? 200 : 500 });
  }
  throw new Error("Fuera del doble local");
});

beforeAll(async () => {
  vi.stubGlobal("fetch", http);
  const [role] = await getSql()`select current_user as name, rolbypassrls, rolsuper from pg_roles where rolname = current_user`;
  expect(role).toEqual({ name: "vocero_app", rolbypassrls: false, rolsuper: false });
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  vi.stubEnv("FCM_SERVICE_ACCOUNT_JSON", JSON.stringify({
    type: "service_account", project_id: "fixture-dashfort",
    client_email: "fixture@fixture-dashfort.iam.gserviceaccount.com",
    private_key: key.export({ type: "pkcs8", format: "pem" }),
  }));
  for (const name of ["Push A", "Push B"]) orgs.push((await crearOrganizacion(name)).id);
  const password = randomBytes(24).toString("hex");
  const hash = await (await getAuth().$context).password.hash(password);
  for (const [index, [key, id]] of Object.entries(users).entries()) {
    const email = `${id}@fixture.test`;
    await db.insert(schema.user).values({ id, email, name: key, emailVerified: true });
    await db.insert(schema.member).values({ id: newId("member"), userId: id, organizationId: key === "outside" ? orgs[1]! : orgs[0]!, role: key === "owner" || key === "outside" ? "owner" : "asesor" });
    await db.insert(schema.account).values({ id: newId("account"), userId: id, accountId: id, providerId: "credential", password: hash });
    const response = await login(req("/api/mobile/session", { "x-forwarded-for": "127.0.0." + (index + 2) }, { email, password }));
    expect(response.status).toBe(200);
    credentials[key as keyof typeof users] = new Headers({ authorization: `Bearer ${(await response.json()).token}` });
  }
  const organizationId = orgs[0]!;
  await db.insert(schema.contact).values({ id: contactId, organizationId, waIdentity: phone, phone, name: "Contacto ficticio", assignedUserId: users.advisor });
  await db.insert(schema.conversation).values({ id: conversationId, organizationId, contactId, aiEnabled: true });
  await db.insert(schema.message).values({ id: messageId, organizationId, conversationId, direction: "in", text: "Contenido privado ficticio" });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await borrarOrganizaciones(orgs);
  await db.delete(schema.user).where(inArray(schema.user.id, Object.values(users)));
});

const devices = schema.mobilePushDevices;

it("validates mobile Bearer/CSRF, encrypts and isolates bindings and treats disabled registration as unavailable", async () => {
  expect((await call("register", null, { token: tokens.owner })).status).toBe(401);
  expect((await call("register", "owner", { token: tokens.owner, userId: users.other })).status).toBe(422);
  expect((await call("register", "owner", { token: "x".repeat(4097) })).status).toBe(422);
  const browser = req(route("register"), { origin: "https://other.example.test", cookie: "better-auth.session_token=fictitious", "sec-fetch-site": "cross-site" }, { token: tokens.owner });
  expect(middleware(browser).status).toBe(403);
  const saved = process.env.FCM_SERVICE_ACCOUNT_JSON;
  delete process.env.FCM_SERVICE_ACCOUNT_JSON;
  expect((await call("register", "owner", { token: tokens.owner })).status).toBe(503);
  expect(http).not.toHaveBeenCalled();
  process.env.FCM_SERVICE_ACCOUNT_JSON = saved;
  for (const who of Object.keys(users) as (keyof typeof users)[])
    expect((await call("register", who, { token: tokens[who] })).status).toBe(200);
  expect((await call("register", "outside", { token: tokens.owner })).status).toBe(409);
  expect((await call("unregister", "other", { token: tokens.owner })).status).toBe(200);
  const [stored] = await db.select().from(devices).where(eq(devices.userId, users.owner));
  expect(JSON.stringify(stored)).not.toContain(tokens.owner);
  expect(openFromStorage(stored!.tokenCipher, stored!.tokenIv, stored!.tokenTag, stored!.keyVersion))
    .toEqual({ ok: true, value: tokens.owner });
  const own = await runWithOrganization(orgs[0]!, () => getDb().select({ organizationId: devices.organizationId }).from(devices));
  expect(new Set(own.map((row) => row.organizationId))).toEqual(new Set([orgs[0]]));
});

it("routes company inbound messages according to current assignment/membership and removes invalid tokens", async () => {
  const sent: string[] = [];
  const stub = { send: async (token: string) => {
    sent.push(token);
    return (token === tokens.advisor ? "invalid_token" : "sent") as "invalid_token" | "sent";
  } };
  await deliverMobilePush(job(), stub);
  expect(new Set(sent)).toEqual(new Set([tokens.owner, tokens.advisor]));
  const [rejected] = await db.select().from(devices).where(eq(devices.userId, users.advisor));
  expect(rejected?.revokedAt).toBeInstanceOf(Date);
  expect((await call("register", "advisor", { token: tokens.advisor })).status).toBe(200);
  await db.update(schema.contact).set({ assignedUserId: null }).where(eq(schema.contact.id, contactId));
  sent.length = 0;
  await deliverMobilePush(job(), stub);
  expect(sent).toEqual([tokens.owner]);
  await db.update(schema.contact).set({ assignedUserId: users.advisor }).where(eq(schema.contact.id, contactId));
  await db.update(schema.conversation).set({ isTest: true }).where(eq(schema.conversation.id, conversationId));
  sent.length = 0;
  await deliverMobilePush(job(), stub);
  expect(sent).toEqual([]);
  await db.update(schema.conversation).set({ isTest: false }).where(eq(schema.conversation.id, conversationId));
  for (const status of ["suspended", "deleted"] as const) {
    await db.update(schema.organization).set({ status }).where(eq(schema.organization.id, orgs[0]!));
    await deliverMobilePush(job(), stub);
    expect(sent).toEqual([]);
  }
  await db.update(schema.organization).set({ status: "active" }).where(eq(schema.organization.id, orgs[0]!));
  forgetOrgStatus(orgs[0]);
});

it("a provider 500 never stalls or retries ingestion and sends no customer data", async () => {
  httpMode = "offline";
  const before = sentBodies.length;
  const networkId = "fixture-" + randomBytes(8).toString("hex");
  await runWithOrganization(orgs[0]!, () => ingestInboundMessage({
    organizationId: orgs[0]!,
    identity: { identity: phone, channel: "whatsapp", phone, waUserId: null, profileName: null },
    waMessageId: networkId, type: "text",
    timestamp: String(Math.floor(Date.now() / 1000)),
    text: "Contenido privado ficticio que no debe llegar a FCM",
  }));
  const stored = await db.select({ id: schema.message.id }).from(schema.message).where(eq(schema.message.waMessageId, networkId));
  expect(stored).toHaveLength(1);
  await vi.waitFor(() => expect(sentBodies.length).toBeGreaterThan(before));
  const sent = sentBodies.slice(before);
  for (const raw of sent) {
    const x = raw as { message: { notification: unknown; data: Record<string, string> } };
    expect(x.message.notification).toEqual({ title: "Dashfort", body: "Nuevo mensaje" });
    expect(Object.keys(x.message.data).sort()).toEqual(["conversationId", "type"]);
    expect(JSON.stringify(x)).not.toContain("Contenido privado");
  }
  expect(sent.length).toBeLessThanOrEqual(2);
});

it("keeps at most five devices, purges inactive ones and cascades logout of the concrete session", async () => {
  for (let i = 0; i < 6; i++) expect((await call("register", "owner", { token: `fixture-owner-device-${i}` })).status).toBe(200);
  const owned = () => db.select().from(devices).where(eq(devices.userId, users.owner));
  expect((await owned()).filter((device) => !device.revokedAt)).toHaveLength(5);
  await db.update(devices).set({ lastSeenAt: new Date(Date.now() - retentionMs - 1000) })
    .where(and(eq(devices.organizationId, orgs[0]!), eq(devices.userId, users.other)));
  await runWithOrganization(orgs[0]!, () => purgeOrgPushDevices(orgs[0]!));
  expect(await db.select().from(devices).where(eq(devices.userId, users.other))).toEqual([]);
  expect((await revoke(req("/api/mobile/session/revoke", credentials.owner))).status).toBe(200);
  expect(await owned()).toEqual([]);
  const sent: string[] = [];
  await db.delete(schema.member).where(eq(schema.member.userId, users.advisor));
  await deliverMobilePush(job(), { send: async (token) => { sent.push(token); return "sent"; } });
  expect(sent).toEqual([]);
});
