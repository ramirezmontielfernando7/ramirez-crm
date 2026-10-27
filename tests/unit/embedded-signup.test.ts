import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  embeddedSignupConfig,
  exchangeCodeForToken,
  registerPhoneNumber,
} from "@/server/whatsapp/embedded-signup";

/**
 * Tech Provider, PR 1 — «Conectar con Facebook»: el código del navegador se
 * cambia por el token del cliente y, si el número es nuevo, se registra. El
 * App Secret viaja a Meta pero jamás a un log ni a un mensaje de error.
 */

const SECRET = "app-secret-super-privado-9f8e";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  vi.stubEnv("META_GRAPH_BASE_URL", "https://graph.test");
  vi.stubEnv("META_APP_ID", "1234567890");
  vi.stubEnv("META_APP_SECRET", SECRET);
  vi.stubEnv("META_EMBEDDED_SIGNUP_CONFIG_ID", "555444333");
  resetEnvCacheForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvCacheForTests();
  warn.mockRestore();
});

describe("embeddedSignupConfig", () => {
  it("devuelve solo lo público cuando la plataforma está configurada", () => {
    const config = embeddedSignupConfig();
    expect(config).toMatchObject({ appId: "1234567890", configId: "555444333" });
    expect(JSON.stringify(config)).not.toContain(SECRET);
  });

  it.each([
    ["META_EMBEDDED_SIGNUP_CONFIG_ID", "REEMPLAZA_config_id_del_registro_insertado"],
    ["META_APP_SECRET", "REEMPLAZA_app_secret_de_tu_app_de_meta"],
    ["META_APP_ID", ""],
  ])("sin %s queda apagado (solo conexión manual)", (name, value) => {
    vi.stubEnv(name, value);
    resetEnvCacheForTests();
    expect(embeddedSignupConfig()).toBeNull();
  });
});

describe("exchangeCodeForToken", () => {
  it("cambia el código por el token del cliente con el token de app", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ access_token: "EAAB-token-cliente", token_type: "bearer" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(exchangeCodeForToken("codigo-abc")).resolves.toEqual({ ok: true, token: "EAAB-token-cliente" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toMatch(/\/oauth\/access_token$/);
    expect(parsed.searchParams.get("client_id")).toBe("1234567890");
    expect(parsed.searchParams.get("client_secret")).toBe(SECRET);
    expect(parsed.searchParams.get("code")).toBe("codigo-abc");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer 1234567890|${SECRET}`);
  });

  it("código vencido: mensaje claro para volver a intentar, sin filtrar el secreto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(json({ error: { message: "This authorization code has expired.", code: 100 } }, 400))
    );

    const res = await exchangeCodeForToken("viejo");
    expect(res).toMatchObject({ ok: false, code: "code_expired" });
    const logged = warn.mock.calls.flat().map((v) => JSON.stringify(v)).join("\n");
    expect(logged).not.toContain(SECRET);
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });

  it("Meta caído → meta_unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ error: { message: "boom", code: 2 } }, 503)));
    await expect(exchangeCodeForToken("x")).resolves.toMatchObject({ ok: false, code: "meta_unavailable" });
  });

  it("sin configurar no llama a Meta", async () => {
    vi.stubEnv("META_EMBEDDED_SIGNUP_CONFIG_ID", "");
    resetEnvCacheForTests();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(exchangeCodeForToken("x")).resolves.toMatchObject({ ok: false, code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respuesta sin token → meta_error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({})));
    await expect(exchangeCodeForToken("x")).resolves.toMatchObject({ ok: false, code: "meta_error" });
  });
});

describe("registerPhoneNumber", () => {
  it("registra el número con su PIN", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(registerPhoneNumber("100000000000009", "tok", "123456")).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/100000000000009\/register$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ messaging_product: "whatsapp", pin: "123456" });
  });

  it("PIN distinto al que ya tiene el número (133005) → pin_mismatch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(json({ error: { message: "Two step verification PIN Mismatch", code: 133005 } }, 400))
    );
    await expect(registerPhoneNumber("1", "tok", "000000")).resolves.toMatchObject({ ok: false, code: "pin_mismatch" });
  });
});
