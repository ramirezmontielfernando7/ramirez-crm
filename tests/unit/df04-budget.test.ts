import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
const mocks = vi.hoisted(() => ({ reserve: vi.fn(), chat: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/ai", () => ({ chatJson: mocks.chat }));
vi.mock("@/lib/env", () => ({ isAiConfigured: () => true }));
vi.mock("@/server/ai-quota/quota", () => ({ ASSISTANT_KIND: "assistant", isAgentKind: () => false, reserveTurn: mocks.reserve, recordUsage: mocks.record }));
vi.mock("@/server/limits/alerts", () => ({ checkAiAlerts: vi.fn(), checkAssistantAlerts: vi.fn() }));
import { chatJsonForOrg } from "@/server/ai-quota/llm";
beforeEach(() => { vi.clearAllMocks(); });
it("DF-04: no llama al proveedor si la reserva falla", async () => {
  mocks.reserve.mockRejectedValue(new Error("db unavailable"));
  const result = await chatJsonForOrg("org", "agent", z.object({}), []);
  expect(result).toMatchObject({ ok: false, error: "quota_exceeded" });
  expect(mocks.chat).not.toHaveBeenCalled();
});
it("DF-04: reserva antes de llamar y reconcilia con el mismo periodo y presupuesto", async () => {
  mocks.reserve.mockResolvedValue({ ok: true });
  mocks.chat.mockImplementation(async () => { expect(mocks.reserve).toHaveBeenCalled(); return { ok: true, data: {}, usage: { promptTokens: 5, completionTokens: 2 } }; });
  await chatJsonForOrg("org", "agent", z.object({}), [{ role: "user", content: "hola" }]);
  const [, , period, budget] = mocks.reserve.mock.calls[0]!;
  expect(budget).toBeGreaterThan(8192);
  expect(mocks.record).toHaveBeenCalledWith("org", "agent", { promptTokens: 5, completionTokens: 2 }, period, budget, expect.any(Number));
});
