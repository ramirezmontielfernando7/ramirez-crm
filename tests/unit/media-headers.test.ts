import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeAttachmentHeaders } from "@/lib/attachment-headers";

/**
 * H9 — Los adjuntos de clientes (`/api/media/[assetId]`) nunca se sirven
 * como documento activo en el origen del CRM.
 *
 * El MIME lo declara quien manda el archivo por WhatsApp. Antes salía tal
 * cual, `inline` y sin `nosniff`: un `text/html` o un `image/svg+xml` se
 * ejecutaba con la sesión de quien lo abría. Ahora rige la política del chat
 * de equipo: `nosniff` + `sandbox` siempre, `inline` solo imágenes raster.
 */

const state = vi.hoisted(() => ({
  asset: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({
    userId: "usr_1",
    organizationId: "org_a",
    role: "owner",
    access: { organizationId: "org_a", userId: "usr_1", seesAll: true },
  }),
}));

/** Cadena de drizzle que devuelve el asset de `state` en `.limit()`. */
function fakeDb(): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "limit") return async () => (state.asset ? [state.asset] : []);
        return () => proxy;
      },
    }
  );
  return proxy;
}

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => fakeDb() };
});

vi.mock("@/server/whatsapp/media", () => ({
  ensureAssetAvailable: async () => null,
  readMediaFile: async () => Buffer.from("<html><script>alert(1)</script></html>"),
}));

const { GET } = await import("@/app/api/media/[assetId]/route");

async function servir(mimeType: string | null, fileName: string | null = null) {
  state.asset = {
    id: "ma_1",
    organizationId: "org_a",
    kind: "document",
    fetchStatus: "available",
    storagePath: "org_a/ma_1",
    mimeType,
    fileName,
  };
  const res = await (GET as (...a: unknown[]) => Promise<Response>)(
    new Request("http://localhost/api/media/ma_1"),
    { params: Promise.resolve({ assetId: "ma_1" }) }
  );
  expect(res.status).toBe(200);
  return res.headers;
}

beforeEach(() => {
  state.asset = null;
});

describe("H9 · /api/media/[assetId] no sirve contenido activo", () => {
  it.each([
    ["text/html", "pagina.html"],
    ["image/svg+xml", "logo.svg"],
  ])("%s sale como descarga, con nosniff y sandbox, y nunca con su MIME", async (mime, name) => {
    const h = await servir(mime, name);
    expect(h.get("content-disposition")).toMatch(/^attachment; filename="/);
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("content-security-policy")).toBe("sandbox");
    expect(h.get("content-type")).toBe("application/octet-stream");
  });

  it("sin nombre de archivo también sale como descarga", async () => {
    const h = await servir("text/html");
    expect(h.get("content-disposition")).toBe("attachment");
    expect(h.get("x-content-type-options")).toBe("nosniff");
  });

  it("una imagen raster sigue viéndose en línea (vista previa de la Bandeja)", async () => {
    const h = await servir("image/jpeg", "foto.jpg");
    expect(h.get("content-disposition")).toBe('inline; filename="foto.jpg"');
    expect(h.get("content-type")).toBe("image/jpeg");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("content-security-policy")).toBe("sandbox");
    expect(h.get("cache-control")).toBe("private, max-age=86400");
  });
});

describe("H9 · política de cabeceras", () => {
  const h = (mimeType: string | null, fileName: string | null = null) =>
    safeAttachmentHeaders({ mimeType, fileName, byteLength: 3 });

  it.each(["image/jpeg", "image/png", "image/webp", "image/gif"])("%s → inline", (mime) => {
    expect(h(mime)["content-disposition"]).toBe("inline");
    expect(h(mime)["content-type"]).toBe(mime);
  });

  it("audio, video y PDF conservan su MIME (se reproducen en <audio>/<video>) pero se descargan al abrirlos", () => {
    expect(h("audio/ogg; codecs=opus")["content-type"]).toBe("audio/ogg; codecs=opus");
    expect(h("video/mp4")["content-type"]).toBe("video/mp4");
    expect(h("application/pdf")["content-type"]).toBe("application/pdf");
    for (const m of ["audio/ogg; codecs=opus", "video/mp4", "application/pdf"]) {
      expect(h(m)["content-disposition"]).toBe("attachment");
    }
  });

  it.each([
    "text/html",
    "image/svg+xml",
    "application/xhtml+xml",
    "text/xml",
    "application/javascript",
    "text/html; charset=utf-8",
    "",
  ])("%s → octet-stream + attachment", (mime) => {
    const out = h(mime || null);
    expect(out["content-type"]).toBe("application/octet-stream");
    expect(out["content-disposition"]).toBe("attachment");
    expect(out["x-content-type-options"]).toBe("nosniff");
    expect(out["content-security-policy"]).toBe("sandbox");
  });

  it("un MIME con parámetros raros no se copia a la cabecera", () => {
    expect(h('audio/ogg; x="a\r\nset-cookie: y"')["content-type"]).toBe("audio/ogg");
  });

  it("el nombre de archivo se sanea", () => {
    expect(h("text/html", 'a"b;c<d>.html')["content-disposition"]).toBe(
      'attachment; filename="a_b_c_d_.html"'
    );
  });
});
