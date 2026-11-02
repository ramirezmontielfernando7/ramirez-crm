import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { chatJson } from "@/lib/ai";
beforeEach(() => {
 for (const [k,v] of Object.entries({ APP_BASE_URL: "http://localhost:3000", DATABASE_URL: "postgresql://t:t@localhost:5432/t", BETTER_AUTH_SECRET: "test-secret-long-enough", ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), META_WEBHOOK_VERIFY_TOKEN: "verify-test", OPENROUTER_API_TOKEN: "test", OPENROUTER_MODEL: "test-model" })) vi.stubEnv(k,v);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("DF-06: 401 es permanente y no se reintenta", async () => {
 const fetcher = vi.fn(async () => new Response("unauthorized", { status: 401 })); vi.stubGlobal("fetch", fetcher);
 expect(await chatJson(z.object({}), [])).toMatchObject({ ok: false, error: "provider_error" });
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it("DF-06: negativa sin texto conserva tokens y no se reintenta", async () => {
 const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: null, refusal: "No puedo" } }], usage: { prompt_tokens: 10, completion_tokens: 3, cost: 0.1 } })); vi.stubGlobal("fetch", fetcher);
 expect(await chatJson(z.object({}), [])).toMatchObject({ ok: false, usage: { promptTokens: 10, completionTokens: 3, costUsd: 0.1 } });
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it("DF-06: respuestas vacías cuentan cada intento", async () => {
 const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: null } }], usage: { prompt_tokens: 10, completion_tokens: 3 } })); vi.stubGlobal("fetch", fetcher);
 expect(await chatJson(z.object({}), [])).toMatchObject({ ok: false, usage: { promptTokens: 20, completionTokens: 6 } });
});
