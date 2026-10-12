import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * 038 (PR 1) — `chatJsonForOrg(…, "assistant", …)`: sin poder revisar el tope
 * del asistente, NO se llama al proveedor (falla cerrado), mientras que los
 * demás usos siguen como siempre (la llamada sigue sin contarse). Los topes
 * reales contra Postgres están en `tests/db/asistente-base.test.ts`.
 */

const m = vi.hoisted(() => ({
  chatJson: vi.fn(),
  reserveTurn: vi.fn(),
  recordUsage: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({ chatJson: m.chatJson }));
vi.mock("@/server/ai-quota/quota", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/ai-quota/quota")>();
  return { ...original, reserveTurn: m.reserveTurn, recordUsage: m.recordUsage };
});
vi.mock("@/server/limits/alerts", () => ({ checkAiAlerts: vi.fn(), checkAssistantAlerts: vi.fn() }));

import { chatJsonForOrg } from "@/server/ai-quota/llm";

const S = z.object({ ok: z.boolean() });

describe("038 — el asistente falla cerrado", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_TOKEN = "sk-test";
    m.chatJson.mockResolvedValue({ ok: true, data: { ok: true }, raw: "{}", usage: { promptTokens: 1, completionTokens: 1 } });
    m.reserveTurn.mockRejectedValue(new Error("BD caída"));
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_TOKEN;
    vi.clearAllMocks();
  });

  it("asistente: no se llama al modelo y lo dice", async () => {
    const r = await chatJsonForOrg("org_a", "assistant", S, []);
    expect(r).toEqual({ ok: false, error: "quota_exceeded", detail: "no se pudo revisar el tope del asistente interno" });
    expect(m.chatJson).not.toHaveBeenCalled();
  });

  it("los demás usos siguen (sin contarse), como antes del 038", async () => {
    const r = await chatJsonForOrg("org_a", "writing", S, []);
    expect(r.ok).toBe(true);
    expect(m.chatJson).toHaveBeenCalledTimes(1);
    expect(m.recordUsage).not.toHaveBeenCalled();
  });

  it("tope agotado o sin tope: el detalle lo distingue", async () => {
    m.reserveTurn.mockResolvedValueOnce({ ok: false, limit: "assistant_tokens" });
    expect(await chatJsonForOrg("org_a", "assistant", S, [])).toMatchObject({ detail: "tope mensual del asistente interno alcanzado" });
    m.reserveTurn.mockResolvedValueOnce({ ok: false, limit: "assistant_unset" });
    expect(await chatJsonForOrg("org_a", "assistant", S, [])).toMatchObject({ detail: "el asistente interno no tiene tope asignado" });
    expect(m.chatJson).not.toHaveBeenCalled();
  });
});
