import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { isMockEnabled as realIsMockEnabled } from "@/lib/env";

/**
 * Firma del webhook de WhatsApp, de punta a punta en la ruta:
 * - con META_APP_SECRET definido se EXIGE (sin firma o inválida → 401 y nada
 *   se procesa);
 * - H7: sin él se RECHAZA todo evento (401) y queda un aviso en el log; el
 *   arranque avisa pero no falla;
 * - la única salida es desarrollo con los mocks (WA_MOCK_ENABLED=true y
 *   NODE_ENV ≠ production). En producción jamás se activa.
 */

const { getEnv, after, processMessagesValue } = vi.hoisted(() => ({
  getEnv: vi.fn(),
  after: vi.fn(),
  processMessagesValue: vi.fn(),
}));
// `isMockEnabled` es el REAL: se controla con WA_MOCK_ENABLED y NODE_ENV.
vi.mock("@/lib/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/env")>();
  return { getEnv, isMockEnabled: original.isMockEnabled };
});
vi.mock("@/lib/db", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("next/server", () => ({ after }));
vi.mock("@/server/inbox/ingest", () => ({
  processMessagesValue,
  processEchoesValue: vi.fn(),
}));
vi.mock("@/server/whatsapp/template-events", () => ({
  processTemplateStatusValue: vi.fn(),
}));

import { POST } from "@/app/api/webhooks/wa/[webhookToken]/route";
import { warnIfWebhookUnsigned } from "@/instrumentation-node";

const TOKEN = "token-de-prueba-123";
const SECRET = "secreto-de-prueba";
const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field: "messages", value: { messages: [] } }] }],
});

function sign(raw: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;
}

function post(headers: Record<string, string> = {}, raw = body) {
  return POST(
    new Request(`http://localhost/api/webhooks/wa/${TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw,
    }),
    { params: Promise.resolve({ webhookToken: TOKEN }) }
  );
}

beforeEach(() => {
  after.mockReset();
  processMessagesValue.mockReset();
});

describe("webhook WA con META_APP_SECRET definido: la firma se exige", () => {
  beforeEach(() => {
    getEnv.mockReturnValue({ META_WEBHOOK_VERIFY_TOKEN: TOKEN, META_APP_SECRET: SECRET });
  });

  it("sin header de firma → 401 y no se procesa nada", async () => {
    const res = await post();
    expect(res.status).toBe(401);
    expect(after).not.toHaveBeenCalled();
  });

  it("firma con otro secreto → 401", async () => {
    const res = await post({ "x-hub-signature-256": sign(body, "otro-secreto") });
    expect(res.status).toBe(401);
    expect(after).not.toHaveBeenCalled();
  });

  it("firma de otro body (evento alterado) → 401", async () => {
    const res = await post({ "x-hub-signature-256": sign("{}", SECRET) });
    expect(res.status).toBe(401);
    expect(after).not.toHaveBeenCalled();
  });

  it("header sin prefijo sha256= → 401", async () => {
    const res = await post({
      "x-hub-signature-256": sign(body, SECRET).slice("sha256=".length),
    });
    expect(res.status).toBe(401);
  });

  it("firma válida → 200 y el evento se procesa", async () => {
    const res = await post({ "x-hub-signature-256": sign(body, SECRET) });
    expect(res.status).toBe(200);
    expect(after).toHaveBeenCalledTimes(1);
    await after.mock.calls[0]?.[0]();
    expect(processMessagesValue).toHaveBeenCalledTimes(1);
  });

  it("token de la URL incorrecto → 404 aunque la firma sea válida", async () => {
    const res = await POST(
      new Request("http://localhost/api/webhooks/wa/otro", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body, SECRET) },
        body,
      }),
      { params: Promise.resolve({ webhookToken: "otro" }) }
    );
    expect(res.status).toBe(404);
  });
});

describe("H7 · webhook WA sin META_APP_SECRET en producción: se rechaza", () => {
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    getEnv.mockReturnValue({ META_WEBHOOK_VERIFY_TOKEN: TOKEN });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WA_MOCK_ENABLED", "");
  });
  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("evento sin firma → 401, nada se procesa y queda un aviso claro (sin valores)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10 * 60_000); // fuera de la ventana de otro test
    try {
      const res = await post();
      expect(res.status).toBe(401);
      expect(after).not.toHaveBeenCalled();
      expect(processMessagesValue).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      const mensaje = String(warn.mock.calls[0]?.[0]);
      expect(mensaje).toMatch(/^\[webhook\] Evento de WhatsApp rechazado \(401\)/);
      expect(mensaje).toContain("META_APP_SECRET");
      expect(mensaje).not.toContain(TOKEN);

      // Meta reintenta: el aviso no inunda el log (uno por minuto).
      expect((await post()).status).toBe(401);
      expect(warn).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 61_000);
      expect((await post()).status).toBe(401);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("una firma cualquiera tampoco pasa → 401", async () => {
    const res = await post({ "x-hub-signature-256": sign(body, "adivinado") });
    expect(res.status).toBe(401);
    expect(after).not.toHaveBeenCalled();
  });

  it("WA_MOCK_ENABLED=true en producción NO abre la salida de desarrollo → 401", async () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    expect(realIsMockEnabled()).toBe(false);
    const res = await post();
    expect(res.status).toBe(401);
    expect(after).not.toHaveBeenCalled();
  });
});

describe("H7 · salida de desarrollo: WA_MOCK_ENABLED=true fuera de producción", () => {
  beforeEach(() => {
    getEnv.mockReturnValue({ META_WEBHOOK_VERIFY_TOKEN: TOKEN });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WA_MOCK_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sin secreto, el evento del wa-mock (sin firma) se acepta → 200 y se procesa", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(after).toHaveBeenCalledTimes(1);
    await after.mock.calls[0]?.[0]();
    expect(processMessagesValue).toHaveBeenCalledTimes(1);
  });

  it("sin WA_MOCK_ENABLED, aun en desarrollo, se rechaza → 401", async () => {
    vi.stubEnv("WA_MOCK_ENABLED", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect((await post()).status).toBe(401);
    } finally {
      warn.mockRestore();
    }
  });

  it("con secreto, los mocks NO relajan la firma: sin firma → 401", async () => {
    getEnv.mockReturnValue({ META_WEBHOOK_VERIFY_TOKEN: TOKEN, META_APP_SECRET: SECRET });
    expect((await post()).status).toBe(401);
    expect((await post({ "x-hub-signature-256": sign(body, SECRET) })).status).toBe(200);
  });
});

describe("aviso al arranque (warnIfWebhookUnsigned)", () => {
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("sin META_APP_SECRET: una advertencia clara, sin lanzar (el arranque no falla)", () => {
    getEnv.mockReturnValue({ META_WEBHOOK_VERIFY_TOKEN: TOKEN });
    vi.stubEnv("WA_MOCK_ENABLED", "");
    try {
      expect(() => warnIfWebhookUnsigned()).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
    expect(warn).toHaveBeenCalledTimes(1);
    const mensaje = String(warn.mock.calls[0]?.[0]);
    expect(mensaje).toMatch(/^\[boot\] META_APP_SECRET no está definido/);
    expect(mensaje).toMatch(/NO se verifica/);
    expect(mensaje).toMatch(/RECHAZA todos los eventos \(401\)/);
    // jamás imprime valores del entorno
    expect(mensaje).not.toContain(TOKEN);
  });

  it("sin META_APP_SECRET y con mocks en desarrollo: avisa que solo ahí se aceptan sin firma", () => {
    getEnv.mockReturnValue({ META_WEBHOOK_VERIFY_TOKEN: TOKEN });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    try {
      warnIfWebhookUnsigned();
    } finally {
      vi.unstubAllEnvs();
    }
    const mensaje = String(warn.mock.calls[0]?.[0]);
    expect(mensaje).toMatch(/^\[boot\] META_APP_SECRET no está definido/);
    expect(mensaje).toMatch(/WA_MOCK_ENABLED=true fuera de producción/);
  });

  it("con META_APP_SECRET: silencio, y el secreto nunca aparece en logs", () => {
    getEnv.mockReturnValue({ META_WEBHOOK_VERIFY_TOKEN: TOKEN, META_APP_SECRET: SECRET });
    warnIfWebhookUnsigned();
    expect(warn).not.toHaveBeenCalled();
  });

  it("entorno inválido: no lanza ni duplica el error", () => {
    getEnv.mockImplementation(() => {
      throw new Error("Variables de entorno inválidas");
    });
    expect(() => warnIfWebhookUnsigned()).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
