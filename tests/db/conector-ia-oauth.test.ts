/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON sin tipar en la prueba */
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sessionContext, type SessionContext } from "@/lib/auth/session";
import { runWithOrganization } from "@/lib/request-context";
import { saveConnectorSettings } from "@/server/ai-connector/settings";
import { forgetOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 047 PR 3 — «Iniciar sesión» OAuth 2.1 del conector contra Postgres real:
 * registro dinámico, aceptar en la pantalla, código de un solo uso con PKCE,
 * llaves de la persona, rotación de la de renovación y cierre por reúso.
 */

const state = vi.hoisted(() => ({ session: null as null | SessionContext }));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...real,
    requireSession: async () => {
      if (!state.session) throw new real.UnauthorizedError();
      return state.session;
    },
    getSessionOrNull: async () => state.session,
  };
});

// Sin red hacia chatgpt.com (como cuando su protección anti-bots rechaza al servidor).
vi.mock("node:dns/promises", () => ({ lookup: async () => { throw new Error("sin red"); } }));

const sys = () => getSystemDb();
let A: Awaited<ReturnType<typeof crearOrganizacion>>;
const u = { owner: "", ana: "" };
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

async function persona(orgId: string, role: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name: role, email: `${id}@oauth.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role });
  return id;
}

async function post(route: string, body: unknown, form = false) {
  const mod = (await import(`@/app/api/${route}/route`)) as Record<string, (r: Request) => Promise<Response>>;
  const res = await mod.POST!(
    new Request(`http://localhost/api/${route}`, {
      method: "POST",
      headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
      body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
    })
  );
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, any>) : null };
}

async function mcp(token: string) {
  const { POST } = await import("@/app/api/mcp/route");
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  );
  return res.status;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function iniciarSesion(clientId: string, scopes: string[] = ["read", "write"], redirect = REDIRECT) {
  const { verifier, challenge } = pkce();
  const params = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    scope: "read write",
    resource: "http://localhost:3000/api/mcp",
  };
  const r = await post("oauth/authorize", { params, decision: "approve", scopes });
  return { r, verifier };
}

beforeAll(async () => {
  A = await crearOrganizacion("OAuth A");
  u.owner = await persona(A.id, "owner");
  u.ana = await persona(A.id, "asesor");
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: A.id, conectorIa: true })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { conectorIa: true } });
  forgetOrgModules(A.id);
  await runWithOrganization(A.id, () =>
    saveConnectorSettings(A.id, u.owner, { enabled: true, allowedRoles: ["asesor"], dailyMessageLimit: 100 })
  );
});

afterAll(async () => {
  await borrarOrganizaciones([A.id]);
  for (const id of Object.values(u)) await sys().delete(schema.user).where(eq(schema.user.id, id));
});

describe("047 PR 3 — iniciar sesión con OAuth", () => {
  let clientId = "";

  it("los metadatos dicen dónde iniciar sesión y que solo hay PKCE S256", async () => {
    const { GET } = await import("@/app/.well-known/oauth-authorization-server/[[...path]]/route");
    const meta = (await (await GET()).json()) as Record<string, unknown>;
    expect(meta).toMatchObject({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/oauth/authorize",
      token_endpoint: "http://localhost:3000/api/oauth/token",
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("registro dinámico: solo https o localhost", async () => {
    expect((await post("oauth/register", { client_name: "Mala", redirect_uris: ["http://evil.example/cb"] })).status).toBe(400);
    const ok = await post("oauth/register", { client_name: "Claude", redirect_uris: [REDIRECT] });
    expect(ok.status).toBe(201);
    clientId = ok.body!.client_id;
    expect(clientId).toMatch(/^dfapp_/);
  });

  it("sin sesión no se acepta nada; otra dirección de regreso tampoco", async () => {
    state.session = null;
    expect((await iniciarSesion(clientId)).r.status).toBe(401);
    state.session = sessionContext(u.ana, A.id, "asesor");
    const { challenge } = pkce();
    const r = await post("oauth/authorize", {
      params: {
        response_type: "code",
        client_id: clientId,
        redirect_uri: "https://otra.example/cb",
        code_challenge: challenge,
        code_challenge_method: "S256",
      },
      decision: "approve",
    });
    expect(r.status).toBe(422);
  });

  it("decir que no regresa con access_denied", async () => {
    state.session = sessionContext(u.ana, A.id, "asesor");
    const { challenge } = pkce();
    const r = await post("oauth/authorize", {
      params: { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s1" },
      decision: "deny",
    });
    const back = new URL(r.body!.redirect);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("s1");
  });

  it("aceptar → código de un solo uso con PKCE → llaves que abren el conector como Ana", async () => {
    state.session = sessionContext(u.ana, A.id, "asesor");
    const { r, verifier } = await iniciarSesion(clientId);
    expect(r.status).toBe(200);
    const back = new URL(r.body!.redirect);
    expect(back.searchParams.get("iss")).toBe("http://localhost:3000");
    expect(back.searchParams.get("state")).toBe("xyz");
    const code = back.searchParams.get("code")!;

    const malo = await post(
      "oauth/token",
      { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: "x".repeat(43) },
      true
    );
    expect(malo.body!.error).toBe("invalid_grant");
    // El código se quemó con el intento fallido: un solo uso, pase lo que pase.
    const otraVez = await post(
      "oauth/token",
      { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier },
      true
    );
    expect(otraVez.body!.error).toBe("invalid_grant");

    const segundo = await iniciarSesion(clientId);
    const code2 = new URL(segundo.r.body!.redirect).searchParams.get("code")!;
    const tok = await post(
      "oauth/token",
      {
        grant_type: "authorization_code",
        code: code2,
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_verifier: segundo.verifier,
        resource: "http://localhost:3000/api/mcp",
      },
      true
    );
    expect(tok.status).toBe(200);
    expect(tok.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "read write" });
    expect(tok.body!.access_token).toMatch(/^dfa_/);
    expect(tok.body!.refresh_token).toMatch(/^dfr_/);
    expect(await mcp(tok.body!.access_token)).toBe(200);
    // La de renovación no abre el conector.
    expect(await mcp(tok.body!.refresh_token)).toBe(401);
    const [cx] = await sys()
      .select()
      .from(schema.aiConnection)
      .where(and(eq(schema.aiConnection.organizationId, A.id), eq(schema.aiConnection.kind, "oauth")));
    expect(cx).toMatchObject({ userId: u.ana, name: "Claude", clientId, scopes: ["read", "write"] });

    // Renovar rota; reusar la vieja dentro de la gracia (ChatGPT renueva dos veces) da otro par.
    const r1 = await post("oauth/token", { grant_type: "refresh_token", refresh_token: tok.body!.refresh_token, client_id: clientId }, true);
    expect(r1.status).toBe(200);
    expect(await mcp(r1.body!.access_token)).toBe(200);
    const gracia = await post("oauth/token", { grant_type: "refresh_token", refresh_token: tok.body!.refresh_token, client_id: clientId }, true);
    expect(gracia.status).toBe(200);
    expect(await mcp(gracia.body!.access_token)).toBe(200);
    expect(await mcp(r1.body!.access_token)).toBe(200);
    // Pasada la gracia, reusarla cierra la conexión entera.
    await sys()
      .update(schema.aiToken)
      .set({ revokedAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(schema.aiToken.tokenHash, (await import("@/server/ai-connector/keys")).hashToken(tok.body!.refresh_token)));
    const reuso = await post("oauth/token", { grant_type: "refresh_token", refresh_token: tok.body!.refresh_token, client_id: clientId }, true);
    expect(reuso.body!.error).toBe("invalid_grant");
    expect(await mcp(r1.body!.access_token)).toBe(401);
  });

  it("DF-08: dos renovaciones simultáneas consumen la llave una sola vez y ninguna cierra la conexión", async () => {
    state.session = sessionContext(u.ana, A.id, "asesor");
    const { r, verifier } = await iniciarSesion(clientId);
    const code = new URL(r.body!.redirect).searchParams.get("code")!;
    const tok = await post("oauth/token", {
      grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: REDIRECT, code_verifier: verifier,
    }, true);
    const oauth = await import("@/server/ai-connector/oauth");
    const settings = await import("@/server/ai-connector/settings");
    const original = settings.getConnectorSettings;
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Ambos leyeron la llave sin revocar antes de competir por consumirla.
    const spy = vi.spyOn(settings, "getConnectorSettings").mockImplementation(async (org) => {
      const value = await original(org);
      if (++arrived === 2) release();
      await gate;
      return value;
    });
    try {
      const input = { refreshToken: tok.body!.refresh_token as string, clientId };
      const results = await Promise.all([oauth.refreshTokens(input), oauth.refreshTokens(input)]);
      // La misma app renovando en paralelo (ChatGPT): las dos reciben su par y la conexión sigue viva.
      const pairs = results.filter((result) => "access_token" in result);
      expect(pairs).toHaveLength(2);
      for (const p of pairs) if ("access_token" in p) expect(await mcp(p.access_token)).toBe(200);
      const [rt] = await sys()
        .select({ revokedAt: schema.aiToken.revokedAt })
        .from(schema.aiToken)
        .where(eq(schema.aiToken.tokenHash, (await import("@/server/ai-connector/keys")).hashToken(input.refreshToken)));
      expect(rt!.revokedAt).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("la app cierra su conexión con /api/oauth/revoke", async () => {
    state.session = sessionContext(u.ana, A.id, "asesor");
    const { r, verifier } = await iniciarSesion(clientId, ["read"]);
    const code = new URL(r.body!.redirect).searchParams.get("code")!;
    const tok = await post(
      "oauth/token",
      { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier },
      true
    );
    expect(tok.body!.scope).toBe("read");
    expect(await mcp(tok.body!.access_token)).toBe(200);
    expect((await post("oauth/revoke", { token: tok.body!.refresh_token }, true)).status).toBe(200);
    expect(await mcp(tok.body!.access_token)).toBe(401);
  });

  it("como ChatGPT: registro, Basic, preflight, initialize y tools/list en stream", async () => {
    const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";
    const reg = await post("oauth/register", {
      client_name: "ChatGPT",
      redirect_uris: [CHATGPT],
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(reg.status).toBe(201);
    const gptId = reg.body!.client_id as string;
    state.session = sessionContext(u.ana, A.id, "asesor");
    const { r, verifier } = await iniciarSesion(gptId, ["read", "write"], CHATGPT);
    const code = new URL(r.body!.redirect).searchParams.get("code")!;
    const { POST: tokenPost } = await import("@/app/api/oauth/token/route");
    const tokRes = await tokenPost(
      new Request("http://localhost/api/oauth/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${Buffer.from(`${gptId}:`).toString("base64")}`,
        },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CHATGPT, code_verifier: verifier }).toString(),
      })
    );
    expect(tokRes.status).toBe(200);
    const access = ((await tokRes.json()) as { access_token: string }).access_token;

    const route = await import("@/app/api/mcp/route");
    const pre = await route.OPTIONS();
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");

    const rpc = (body: unknown, accept = "application/json, text/event-stream") =>
      route.POST(
        new Request("http://localhost/api/mcp", {
          method: "POST",
          headers: { authorization: `Bearer ${access}`, "content-type": "application/json", accept },
          body: JSON.stringify(body),
        })
      );
    const init = await rpc({
      jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "openai-mcp", version: "1.0.0" } },
    });
    expect(init.status).toBe(200);
    expect(init.headers.get("access-control-allow-origin")).toBe("*");
    const initBody = (await init.json()) as any;
    expect(initBody.result.protocolVersion).toBe("2025-06-18");
    expect(initBody.result.capabilities.tools).toBeDefined();
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);

    // Solo stream: la respuesta llega como un evento SSE.
    const list = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "text/event-stream");
    expect(list.status).toBe(200);
    expect(list.headers.get("content-type")).toContain("text/event-stream");
    const sse = await list.text();
    const data = /^data: (.+)$/m.exec(sse)![1]!;
    const tools = (JSON.parse(data) as any).result.tools as { name: string; inputSchema: { type: string } }[];
    expect(tools.length).toBeGreaterThan(10);
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["list_chats", "read_chat", "send_message"]));
    for (const t of tools) expect(t.inputSchema.type).toBe("object");

    // Sin llave: 401 que el navegador puede leer (WWW-Authenticate expuesto).
    const { POST } = route;
    const sin = await POST(new Request("http://localhost/api/mcp", { method: "POST", body: "{}" }));
    expect(sin.status).toBe(401);
    expect(sin.headers.get("access-control-expose-headers")).toContain("www-authenticate");
  });

  it("como ChatGPT con CIMD: sus metadatos no se pueden leer, state largo y resource → llaves", async () => {
    const clientId = "https://chatgpt.com/oauth/cb_test123/client.json";
    const redirect = "https://chatgpt.com/connector/oauth/cb_test123";
    state.session = sessionContext(u.ana, A.id, "asesor");
    const { verifier, challenge } = pkce();
    const params = {
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "s".repeat(1500),
      scope: "read write",
      resource: "http://localhost:3000/api/mcp",
    };
    const r = await post("oauth/authorize", { params, decision: "approve", scopes: ["read", "write"] });
    expect(r.status).toBe(200);
    const back = new URL(r.body!.redirect);
    expect(back.origin + back.pathname).toBe(redirect);
    expect(back.searchParams.get("state")).toBe(params.state);
    expect(back.searchParams.get("iss")).toBe("http://localhost:3000");
    const tok = await post(
      "oauth/token",
      {
        grant_type: "authorization_code",
        code: back.searchParams.get("code")!,
        redirect_uri: redirect,
        code_verifier: verifier,
        client_id: clientId,
        resource: "http://localhost:3000/api/mcp",
      },
      true
    );
    expect(tok.status).toBe(200);
    expect(await mcp(tok.body!.access_token as string)).toBe(200);

    // A otra dirección (aunque parezca de ChatGPT) nunca.
    const bad = await post("oauth/authorize", {
      params: { ...params, redirect_uri: "https://chatgpt.com.evil.example/cb" },
      decision: "approve",
      scopes: ["read"],
    });
    expect(bad.status).toBe(422);
  });

  it("si el Propietario apaga el conector, ni se acepta ni se renueva", async () => {
    state.session = sessionContext(u.ana, A.id, "asesor");
    const { r, verifier } = await iniciarSesion(clientId);
    const code = new URL(r.body!.redirect).searchParams.get("code")!;
    await runWithOrganization(A.id, () =>
      saveConnectorSettings(A.id, u.owner, { enabled: false, allowedRoles: ["asesor"], dailyMessageLimit: 100 })
    );
    expect((await iniciarSesion(clientId)).r.status).toBe(403);
    const tok = await post(
      "oauth/token",
      { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier },
      true
    );
    expect(tok.body!.error).toBe("invalid_grant");
  });
});
