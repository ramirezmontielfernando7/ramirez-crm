import { afterEach, describe, expect, it, vi } from "vitest";
import { mockGuard } from "@/lib/dev-guard";
import { isLoopbackUrl, isMockEnabled } from "@/lib/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mockGuard (FR-080: mocks en producción → 404)", () => {
  it("producción con flag activo → 404 igualmente", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "production");
    const res = mockGuard();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it("desarrollo sin flag → 404", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(mockGuard()?.status).toBe(404);
  });

  it("desarrollo con flag → permitido (null)", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(mockGuard()).toBeNull();
  });

  it("test con flag → permitido (null)", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    expect(mockGuard()).toBeNull();
  });
});

/**
 * La app COMPILADA (`next start`, NODE_ENV=production) del job e2e de CI.
 * Los mocks solo se abren con los TRES candados a la vez: WA_MOCK_ENABLED,
 * ALLOW_CI_MOCKS y APP_BASE_URL en localhost/127.0.0.1. Cualquier otra
 * combinación en producción sigue en 404.
 */
describe("mockGuard en producción (app compilada del CI)", () => {
  function prod(env: Record<string, string>) {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WA_MOCK_ENABLED", "");
    vi.stubEnv("ALLOW_CI_MOCKS", "");
    vi.stubEnv("APP_BASE_URL", "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  }

  it("producción normal con WA_MOCK_ENABLED (dominio real) → 404", () => {
    prod({ WA_MOCK_ENABLED: "true", APP_BASE_URL: "https://crm.ejemplo.com" });
    expect(isMockEnabled()).toBe(false);
    expect(mockGuard()?.status).toBe(404);
  });

  it("ALLOW_CI_MOCKS con un dominio real en APP_BASE_URL → 404", () => {
    prod({ WA_MOCK_ENABLED: "true", ALLOW_CI_MOCKS: "true", APP_BASE_URL: "https://crm.ejemplo.com" });
    expect(isMockEnabled()).toBe(false);
    expect(mockGuard()?.status).toBe(404);
  });

  it("dominios que solo se parecen a localhost → 404", () => {
    for (const url of [
      "https://localhost.ejemplo.com",
      "http://localhost@ejemplo.com",
      "http://127.0.0.1.nip.io:3000",
      "http://ejemplo.com/?h=localhost",
      "http://0.0.0.0:3000",
      "no es una url",
    ]) {
      prod({ WA_MOCK_ENABLED: "true", ALLOW_CI_MOCKS: "true", APP_BASE_URL: url });
      expect(isMockEnabled(), url).toBe(false);
      expect(mockGuard()?.status, url).toBe(404);
    }
  });

  it("localhost sin ALLOW_CI_MOCKS → 404", () => {
    prod({ WA_MOCK_ENABLED: "true", APP_BASE_URL: "http://localhost:3000" });
    expect(isMockEnabled()).toBe(false);
    expect(mockGuard()?.status).toBe(404);
  });

  it("ALLOW_CI_MOCKS + localhost pero SIN WA_MOCK_ENABLED → 404", () => {
    prod({ ALLOW_CI_MOCKS: "true", APP_BASE_URL: "http://localhost:3000" });
    expect(isMockEnabled()).toBe(false);
    expect(mockGuard()?.status).toBe(404);
  });

  it("ALLOW_CI_MOCKS distinto de \"true\" → 404", () => {
    prod({ WA_MOCK_ENABLED: "true", ALLOW_CI_MOCKS: "1", APP_BASE_URL: "http://localhost:3000" });
    expect(mockGuard()?.status).toBe(404);
  });

  it("los tres candados (localhost) → permitido", () => {
    prod({ WA_MOCK_ENABLED: "true", ALLOW_CI_MOCKS: "true", APP_BASE_URL: "http://localhost:3000" });
    expect(isMockEnabled()).toBe(true);
    expect(mockGuard()).toBeNull();
  });

  it("los tres candados (127.0.0.1) → permitido", () => {
    prod({ WA_MOCK_ENABLED: "true", ALLOW_CI_MOCKS: "true", APP_BASE_URL: "http://127.0.0.1:3000" });
    expect(isMockEnabled()).toBe(true);
    expect(mockGuard()).toBeNull();
  });

  it("se decide en runtime: quitar una bandera cierra los mocks al momento", () => {
    prod({ WA_MOCK_ENABLED: "true", ALLOW_CI_MOCKS: "true", APP_BASE_URL: "http://localhost:3000" });
    expect(mockGuard()).toBeNull();
    vi.stubEnv("ALLOW_CI_MOCKS", "false");
    expect(mockGuard()?.status).toBe(404);
  });
});

describe("isLoopbackUrl", () => {
  it("solo localhost y 127.0.0.1, con o sin puerto", () => {
    expect(isLoopbackUrl("http://localhost:3000")).toBe(true);
    expect(isLoopbackUrl("http://127.0.0.1")).toBe(true);
    expect(isLoopbackUrl("https://LOCALHOST:8443/x")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:3000")).toBe(false);
    expect(isLoopbackUrl("https://app.vocerocrm.com")).toBe(false);
    expect(isLoopbackUrl(undefined)).toBe(false);
    expect(isLoopbackUrl("")).toBe(false);
  });
});
