import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiMockCompletion } from "@/server/dev/ai-mock";
import {
  buildWritingMessages,
  WRITING_ASSIST_MARKER,
  WRITING_MAX_CHARS,
  writingRequestSchema,
} from "@/server/writing-assist/prompts";

/**
 * 023 — Asistente de redacción: esquema, prompt, ruta (errores sin perder el
 * texto) y separación total del agente de IA.
 */

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({
    userId: "usr_asesor",
    organizationId: "org_a",
    role: "asesor",
    access: { organizationId: "org_a", userId: "usr_asesor", seesAll: false },
  }),
}));

describe("esquema de la petición", () => {
  it("acepta las cinco acciones", () => {
    for (const action of ["improve", "summarize", "shorten", "lengthen"] as const) {
      expect(writingRequestSchema.safeParse({ action, text: "hola" }).success).toBe(true);
    }
    expect(
      writingRequestSchema.safeParse({ action: "tone", tone: "empatico", text: "hola" }).success
    ).toBe(true);
  });

  it("cambiar tono sin tono → inválido", () => {
    expect(writingRequestSchema.safeParse({ action: "tone", text: "hola" }).success).toBe(false);
  });

  it("texto vacío, solo espacios o demasiado largo → inválido", () => {
    expect(writingRequestSchema.safeParse({ action: "improve", text: "   " }).success).toBe(false);
    expect(
      writingRequestSchema.safeParse({ action: "improve", text: "a".repeat(WRITING_MAX_CHARS + 1) })
        .success
    ).toBe(false);
  });

  it("acción desconocida → inválido", () => {
    expect(writingRequestSchema.safeParse({ action: "traducir", text: "hola" }).success).toBe(false);
  });
});

describe("prompt", () => {
  it("lleva la marca, pide JSON y no inventar, y trae el borrador", () => {
    const msgs = buildWritingMessages({ action: "tone", tone: "formal", text: "hola que tal" });
    expect(msgs[0]?.content).toContain(WRITING_ASSIST_MARKER);
    expect(msgs[0]?.content).toMatch(/JSON/);
    expect(msgs[0]?.content).toMatch(/No inventes/);
    expect(msgs[1]?.content).toContain("ACCIÓN: tone (formal)");
    expect(msgs[1]?.content).toContain("BORRADOR:\nhola que tal");
  });
});

describe("ai-mock del asistente", () => {
  const run = (action: string, text: string, tone?: string) => {
    const req = writingRequestSchema.parse({ action, tone, text });
    return aiMockCompletion(buildWritingMessages(req));
  };

  it("devuelve {text} por acción", () => {
    expect(JSON.parse(run("improve", "hola si lo tenemos")).text).toBe("Hola sí lo tenemos.");
    expect(JSON.parse(run("tone", "hola", "empatico")).text).toMatch(/^Entiendo/);
    expect(JSON.parse(run("lengthen", "hola")).text.length).toBeGreaterThan(20);
  });

  it("FALLA-IA simula un modelo sin JSON", () => {
    expect(() => JSON.parse(run("improve", "FALLA-IA hola"))).toThrow();
  });
});

describe("POST /api/writing-assist", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    vi.stubEnv("OPENROUTER_MODEL", "modelo-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const post = async (body: unknown) => {
    const { POST } = await import("@/app/api/writing-assist/route");
    return POST(
      new Request("http://localhost/api/writing-assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  };

  const provider = (content: string, status = 200) =>
    vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })
    );

  it("un asesor reescribe su borrador → 200 {text}", async () => {
    vi.stubGlobal("fetch", provider('{"text":"Hola, sí lo tenemos."}'));
    const res = await post({ action: "improve", text: "hola si lo tenemos" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Hola, sí lo tenemos." });
  });

  it("el modelo no devuelve JSON → 502 con mensaje (el editor conserva el texto)", async () => {
    vi.stubGlobal("fetch", provider("no puedo"));
    const res = await post({ action: "improve", text: "hola" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Intenta de nuevo/);
  }, 15_000);

  it("sin IA configurada → 503 not_configured, sin llamar al proveedor", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post({ action: "improve", text: "hola" });
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("body inválido → 422", async () => {
    const res = await post({ action: "tone", text: "hola" });
    expect(res.status).toBe(422);
  });
});

describe("independencia del agente", () => {
  it("el módulo no importa nada de src/server/ai (el agente)", () => {
    const dir = path.resolve(import.meta.dirname, "..", "..", "src", "server", "writing-assist");
    for (const f of ["prompts.ts", "rewrite.ts"]) {
      const code = readFileSync(path.join(dir, f), "utf8");
      expect(code, f).not.toMatch(/@\/server\/ai\//);
    }
  });
});
