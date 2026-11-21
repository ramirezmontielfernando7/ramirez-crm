import { randomBytes } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as webAuth } from "@/app/api/auth/[...all]/route";
import { GET as list } from "@/app/api/conversations/route";
import { GET as messages } from "@/app/api/conversations/[id]/messages/route";
import { POST as mcp } from "@/app/api/mcp/route";
import { POST as login } from "@/app/api/mobile/session/route";
import { POST as revoke } from "@/app/api/mobile/session/revoke/route";
import { withAuth } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { sessionFromHeaders } from "@/lib/auth/session";
import { getSql, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetRateLimit } from "@/lib/rate-limit";
import { middleware } from "@/middleware";
import { requireBotKey } from "@/server/bot/auth";
import { assertOrgActive, forgetOrgStatus } from "@/server/platform-admin/org-status";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));

const base = process.env.APP_BASE_URL!;
const origin = new URL(base).origin;
const ids = { advisor: newId("user"), teammate: newId("user"), otherOrg: newId("user") };
const emails = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, `${id}@fixture.test`]));
const password = randomBytes(24).toString("hex");
const credentials = { email: emails.advisor, password };
const orgs: string[] = [];

function post(path: string, body: object, headers: HeadersInit = {}) {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json");
  return new Request(base + path, { method: "POST", headers: merged, body: JSON.stringify(body) });
}

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` });
const webRequest = { origin, "sec-fetch-site": "same-origin" };
const noBrowserResponseHeaders = ["set-cookie", "set-auth-token", "access-control-expose-headers"];

async function mobileToken() {
  const result = await login(post("/api/mobile/session", credentials));
  expect(result.status).toBe(200);
  for (const header of noBrowserResponseHeaders) expect(result.headers.has(header)).toBe(false);
  expect(result.headers.get("cache-control")).toBe("no-store");
  const body = await result.json();
  expect(Object.keys(body).sort()).toEqual(["expiresAt", "token"]);
  expect(typeof body.token === "string" && body.token.includes(".")).toBe(true);
  expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  return bearer(body.token);
}

async function webCookie() {
  const result = await webAuth(post("/api/auth/sign-in/email", credentials, webRequest));
  expect(result.status).toBe(200);
  for (const header of noBrowserResponseHeaders.slice(1)) expect(result.headers.has(header)).toBe(false);
  const authCookie = (await getAuth().$context).authCookies.sessionToken.name;
  if (origin.startsWith("https:")) expect(authCookie.startsWith("__Secure-")).toBe(true);
  const cookie = result.headers.getSetCookie().find((line) => line.startsWith(`${authCookie}=`));
  expect(Boolean(cookie)).toBe(true);
  expect(cookie?.includes("HttpOnly")).toBe(true);
  return new Headers({ cookie: cookie!.split(";")[0]! });
}

async function getPage(headers: Headers, query = "?limit=1") {
  request.headers = headers;
  return list(new Request(base + "/api/conversations" + query, { headers }));
}

async function getMessages(headers: Headers, id: string) {
  request.headers = headers;
  return messages(new Request(base + `/api/conversations/${id}/messages`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

async function chat(org: string, user: string, label: string, date: Date) {
  const db = getSystemDb();
  const contactId = newId("contact");
  const id = newId("conversation");
  await db.insert(schema.contact).values({
    id: contactId, organizationId: org, waIdentity: contactId, name: label, assignedUserId: user,
  });
  await db.insert(schema.conversation).values({
    id, organizationId: org, contactId, lastMessageAt: date, lastInboundAt: date,
  });
  await db.insert(schema.message).values({
    id: newId("message"), organizationId: org, conversationId: id, text: label,
    direction: "in", createdAt: date,
  });
  return id;
}

async function setStatus(org: string, status: "active" | "suspended") {
  await getSystemDb().update(schema.organization).set({ status }).where(eq(schema.organization.id, org));
  forgetOrgStatus(org);
}

describe("C1-A2 · contrato web y móvil con Postgres y RLS", () => {
  let first: string;
  let second: string;
  let assignedToTeammate: string;
  let foreign: string;

  beforeAll(async () => {
    const [role] = await getSql()`select current_user as name, rolbypassrls, rolsuper
      from pg_roles where rolname = current_user`;
    expect(role).toEqual({ name: "vocero_app", rolbypassrls: false, rolsuper: false });
    const [policy] = await getSystemDb().execute<{ relforcerowsecurity: boolean }>(
      sql`select relforcerowsecurity from pg_class where oid = 'conversation'::regclass`
    );
    expect(policy?.relforcerowsecurity).toBe(true);

    const a = await crearOrganizacion("C1A2 A");
    const b = await crearOrganizacion("C1A2 B");
    orgs.push(a.id, b.id);
    const db = getSystemDb();
    for (const [key, id] of Object.entries(ids)) {
      await db.insert(schema.user).values({ id, name: key, email: emails[key]!, emailVerified: true });
      await db.insert(schema.member).values({
        id: newId("member"), organizationId: key === "otherOrg" ? b.id : a.id, userId: id, role: "asesor",
      });
    }
    await db.insert(schema.account).values({
      id: newId("account"), accountId: ids.advisor, userId: ids.advisor, providerId: "credential",
      password: await (await getAuth().$context).password.hash(password),
    });
    const date = (offset: number) => new Date(1_770_000_000_000 + offset);
    first = await chat(a.id, ids.advisor, "Visible A 1", date(2000));
    second = await chat(a.id, ids.advisor, "Visible A 2", date(1000));
    assignedToTeammate = await chat(a.id, ids.teammate, "Otro asesor A", date(3000));
    foreign = await chat(b.id, ids.otherOrg, "Privado B", date(4000));
  });

  afterAll(async () => {
    await borrarOrganizaciones(orgs);
    await getSystemDb().delete(schema.user).where(inArray(schema.user.id, Object.values(ids)));
  });
  beforeEach(() => resetRateLimit());

  it("conserva el contrato de login web y rechaza el intercambio móvil desde un navegador", async () => {
    await webCookie();
    for (const browserHeader of [new Headers({ origin }), new Headers({ "sec-fetch-site": "same-origin" })]) {
      browserHeader.set("x-mobile-app", "dashfort");
      const blocked = await login(post("/api/mobile/session", credentials, browserHeader));
      expect(blocked.status).toBe(403);
      expect(Object.hasOwn(await blocked.json(), "token")).toBe(false);
      for (const header of noBrowserResponseHeaders) expect(blocked.headers.has(header)).toBe(false);
    }
  });

  it("mantiene el 403 CSRF para POST web cruzado con cookie", async () => {
    const cookie = await webCookie();
    cookie.set("origin", "https://external.example.test");
    cookie.set("sec-fetch-site", "cross-site");
    const res = middleware(new NextRequest(base + "/api/contacts", { method: "POST", headers: cookie }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("cross_site_request");
  });

  it("verifica la firma, prioriza cookie y revoca la sesión móvil sin cerrar la web", async () => {
    const native = await mobileToken();
    const browser = await webCookie();
    const auth = native.get("authorization")!;
    const tail = auth.at(-1);
    const altered = new Headers({ authorization: auth.slice(0, -16) + (tail === "a" ? "b" : "a") + auth.slice(-15) });
    for (const headers of [bearer("raw"), altered]) {
      expect((await getPage(headers)).status).toBe(401);
      expect(await sessionFromHeaders(headers)).toBeNull();
    }
    const cookieAndBearer = new Headers(browser);
    cookieAndBearer.set("authorization", altered.get("authorization")!);
    expect((await getPage(cookieAndBearer)).status).toBe(200);
    const badCookieAndBearer = new Headers(native);
    badCookieAndBearer.set("cookie", browser.get("cookie")!.split("=")[0] + "=invalid");
    expect((await getPage(badCookieAndBearer)).status).toBe(401);

    expect((await getPage(native)).status).toBe(200);
    expect((await sessionFromHeaders(native))?.userId).toBe(ids.advisor);
    expect((await revoke(post("/api/mobile/session/revoke", {}, altered))).status).toBe(401);
    const signedOut = await revoke(post("/api/mobile/session/revoke", {}, native));
    expect(signedOut.status).toBe(200);
    for (const header of noBrowserResponseHeaders) expect(signedOut.headers.has(header)).toBe(false);
    expect((await getPage(native)).status).toBe(401);
    expect((await getPage(browser)).status).toBe(200);
  });

  it("devuelve 401 al caducar la sesión móvil", async () => {
    const native = await mobileToken();
    await getSystemDb().update(schema.session).set({ expiresAt: new Date(0) })
      .where(eq(schema.session.userId, ids.advisor));
    expect((await getPage(native)).status).toBe(401);
    expect((await revoke(post("/api/mobile/session/revoke", {}, native))).status).toBe(401);
  });

  it("respeta el límite FR-062 compartido con el login web", async () => {
    const ip = { "x-forwarded-for": "192.0.2.12" };
    for (let i = 0; i < 9; i++) {
      expect((await login(post("/api/mobile/session", {
        email: "missing@fixture.test", password,
      }, ip))).status).toBe(401);
    }
    expect((await webAuth(post("/api/auth/sign-in/email", credentials, { ...webRequest, ...ip }))).status).toBe(200);
    expect((await login(post("/api/mobile/session", credentials, ip))).status).toBe(429);
  });

  it("devuelve los tres estados de suspensión con el mismo código web", async () => {
    const org = orgs[0]!;
    const native = await mobileToken();
    const browser = await webCookie();
    try {
      await setStatus(org, "suspended");
      for (const result of [
        await login(post("/api/mobile/session", credentials)),
        await webAuth(post("/api/auth/sign-in/email", credentials, webRequest)),
      ]) {
        expect(result.status).toBe(403);
        expect((await result.json()).code).toBe("ORGANIZATION_SUSPENDED");
      }
      for (const headers of [native, browser]) {
        const open = await getPage(headers);
        expect(open.status).toBe(401);
        expect((await open.json()).error.code).toBe("unauthorized");

        await setStatus(org, "active");
        request.headers = headers;
        const midOperation = await withAuth(async (session) => {
          await setStatus(org, "suspended");
          await assertOrgActive(session.organizationId);
          return new Response(null, { status: 204 });
        })();
        expect(midOperation.status).toBe(403);
        expect((await midOperation.json()).error.code).toBe("organization_suspended");
      }
    } finally {
      await setStatus(org, "active");
    }
  });

  it("entrega al asesor las mismas dos páginas e historial web, bajo RLS", async () => {
    const native = await mobileToken();
    const browser = await webCookie();
    let query = "?limit=1";
    for (const id of [first, second]) {
      const web = await getPage(browser, query);
      const mobile = await getPage(native, query);
      expect(web.status).toBe(200);
      expect(mobile.status).toBe(200);
      const payload = await mobile.json();
      expect(payload).toEqual(await web.json());
      expect(payload.conversations.map((x: { id: string }) => x.id)).toEqual([id]);
      if (id === first) {
        expect(typeof payload.nextCursor).toBe("string");
        query = `?limit=1&cursor=${encodeURIComponent(payload.nextCursor)}`;
      } else {
        expect(payload.nextCursor).toBeNull();
      }
    }
    for (const id of [first, second, assignedToTeammate, foreign]) {
      const web = await getMessages(browser, id);
      const mobile = await getMessages(native, id);
      expect(mobile.status).toBe(id === first || id === second ? 200 : 404);
      expect(mobile.status).toBe(web.status);
      const payload = await mobile.json();
      expect(payload).toEqual(await web.json());
      if (mobile.ok) expect(payload.messages).toHaveLength(1);
    }
  });

  it("la sesión móvil no autentica MCP ni el Bot", async () => {
    const native = await mobileToken();
    expect((await mcp(post("/api/mcp", {}, native))).status).toBe(401);
    const bot = await requireBotKey(new Request(base + "/api/bot/context", { headers: native }));
    expect(bot.ok).toBe(false);
    if (!bot.ok) expect(bot.response.status).toBe(401);
  });
});
