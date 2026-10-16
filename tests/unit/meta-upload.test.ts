import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";
import { uploadTemplateHeaderSample } from "@/lib/meta/upload";

const file = { data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("subida reanudable de la imagen de ejemplo", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("META_GRAPH_BASE_URL", "https://graph.test");
    vi.stubEnv("META_APP_ID", "1234567890");
    resetEnvCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetEnvCacheForTests();
  });

  it("usa el ID de la app y acepta el id de sesión con su firma (?sig=)", async () => {
    const id = "upload:MTphdHRhY2htZW50OjZiZGQ=?sig=ARZx-abc_123";
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ id })).mockResolvedValueOnce(json({ h: "4::aW1n" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadTemplateHeaderSample("tok", file)).resolves.toBe("4::aW1n");
    const [first, second] = fetchMock.mock.calls as [string, RequestInit][];
    expect(first![0]).toMatch(/^https:\/\/graph\.test\/v[\d.]+\/1234567890\/uploads\?file_length=3&file_type=image%2Fjpeg$/);
    expect(second![0]).toMatch(new RegExp(`/${id.replace(/[?=]/g, "\\$&")}$`));
    expect((second![1].headers as Record<string, string>).Authorization).toBe("OAuth tok");
  });

  it("propaga el motivo real de Meta (mensaje, texto para el usuario y subcódigo)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        json(
          {
            error: {
              message: "(#100) Invalid parameter",
              code: 100,
              error_subcode: 2207067,
              error_user_msg: "El archivo no es válido",
            },
          },
          400
        )
      )
    );
    const err = await uploadTemplateHeaderSample("tok", file).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).status).toBe(400);
    expect((err as MetaApiError).code).toBe(100);
    expect((err as Error).message).toBe("(#100) Invalid parameter — El archivo no es válido (subcódigo 2207067)");
  });

  it("una sesión inválida dice qué devolvió Meta", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ foo: 1 })));
    await expect(uploadTemplateHeaderSample("tok", file)).rejects.toThrow(/sesión de subida válida.*"foo":1/);
  });
});
