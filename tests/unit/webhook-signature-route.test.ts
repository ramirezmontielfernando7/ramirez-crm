import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

/**
 * Firma del webhook de WhatsApp, de punta a punta en la ruta:
 * - con META_APP_SECRET definido se EXIGE (sin firma o inválida → 401 y nada
 *   se procesa);
 * - sin él la instancia sigue recibiendo (no se rompe nada que ya funcione),
 *   pero el arranque lo avisa.
 */

const { getEnv, after, processMessagesValue } = vi.hoisted(() => ({
  getEnv: vi.fn(),
  after: vi.fn(),
  processMessagesValue: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getEnv }));
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

describe("webhook WA sin META_APP_SECRET: la instancia sigue funcionando", () => {
  beforeEach(() => {
    getEnv.mockReturnValue({ META_WEBHOOK_VERIFY_TOKEN: TOKEN });
  });

  it("evento sin firma → 200 y se procesa (no rompe instancias existentes)", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(after).toHaveBeenCalledTimes(1);
    await after.mock.calls[0]?.[0]();
    expect(processMessagesValue).toHaveBeenCalledTimes(1);
  });

  it("una firma cualquiera no se valida ni rechaza → 200", async () => {
    const res = await post({ "x-hub-signature-256": "sha256=basura" });
    expect(res.status).toBe(200);
  });
});

describe("aviso al arranque (warnIfWebhookUnsigned)", () => {
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("sin META_APP_SECRET: una advertencia clara, sin lanzar", () => {
    getEnv.mockReturnValue({ META_WEBHOOK_VERIFY_TOKEN: TOKEN });
    expect(() => warnIfWebhookUnsigned()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    const mensaje = String(warn.mock.calls[0]?.[0]);
    expect(mensaje).toMatch(/^\[boot\] META_APP_SECRET no está definido/);
    expect(mensaje).toMatch(/NO se verifica/);
    // jamás imprime valores del entorno
    expect(mensaje).not.toContain(TOKEN);
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
