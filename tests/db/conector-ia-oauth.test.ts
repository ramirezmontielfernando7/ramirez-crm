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

async function iniciarSesion(clientId: string, scopes: string[] = ["read", "write"]) {
  const { verifier, challenge } = pkce();
  const params = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
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

    // Renovar rota; reusar la vieja cierra la conexión entera.
    const r1 = await post("oauth/token", { grant_type: "refresh_token", refresh_token: tok.body!.refresh_token, client_id: clientId }, true);
    expect(r1.status).toBe(200);
    expect(await mcp(r1.body!.access_token)).toBe(200);
    const reuso = await post("oauth/token", { grant_type: "refresh_token", refresh_token: tok.body!.refresh_token, client_id: clientId }, true);
    expect(reuso.body!.error).toBe("invalid_grant");
    expect(await mcp(r1.body!.access_token)).toBe(401);
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
