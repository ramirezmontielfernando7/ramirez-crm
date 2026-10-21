import { describe, expect, it } from "vitest";
import {
  checkOutgoing,
  formatSize,
  libraryFileProblem,
  MAX_HEAVY_UPLOADS,
  MB,
  uploadHttpMessage,
} from "@/lib/upload-limits";
import { validateOutgoing } from "@/server/whatsapp/media";
import { heavyUploadsInFlight, readUploadForm, withUploadSlot } from "@/server/uploads/body";

/**
 * 044 — Topes de subida: la misma regla en el navegador y en el servidor, y
 * la lectura del multipart que nunca mete a memoria más de lo permitido.
 */

describe("checkOutgoing (Bandeja → WhatsApp)", () => {
  it("dice el límite de cada tipo en palabras", () => {
    const foto = checkOutgoing("image/jpeg", 8 * MB, "foto.jpg");
    expect(foto).toMatchObject({ ok: false, code: "too_large" });
    expect(!foto.ok && foto.message).toMatch(/foto pesa 8 MB.*hasta 5 MB/);
    const video = checkOutgoing("video/mp4", 40 * MB, "promo.mp4");
    expect(!video.ok && video.message).toMatch(/video pesa 40 MB.*16 MB.*enlace/);
    const pdf = checkOutgoing("application/pdf", 120 * MB, "catalogo.pdf");
    expect(!pdf.ok && pdf.message).toMatch(/120 MB.*100 MB/);
  });

  it("un PDF de 90 MB sí sale como documento", () => {
    expect(checkOutgoing("application/pdf", 90 * MB, "catalogo.pdf")).toEqual({ ok: true, kind: "document" });
  });

  it("SVG y HTML nunca, ni por tipo ni por extensión", () => {
    expect(checkOutgoing("image/svg+xml", 1000, "logo.svg")).toMatchObject({ ok: false, code: "unsupported_type" });
    expect(checkOutgoing("application/octet-stream", 1000, "pagina.html")).toMatchObject({ ok: false, code: "unsupported_type" });
  });

  it("el servidor lanza el mismo mensaje que ve el navegador", () => {
    const client = checkOutgoing("video/mp4", 20 * MB);
    expect(() => validateOutgoing("video/mp4", 20 * MB)).toThrowError(!client.ok ? client.message : "");
  });
});

describe("libraryFileProblem (Biblioteca)", () => {
  it("acepta PDF, Word, texto e imágenes", () => {
    expect(libraryFileProblem("application/pdf", "a.pdf", MB)).toBeNull();
    expect(libraryFileProblem("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx", MB)).toBeNull();
    expect(libraryFileProblem("image/png", "a.png", MB)).toBeNull();
    // Sin tipo del navegador: decide la extensión.
    expect(libraryFileProblem("application/octet-stream", "notas.md", MB)).toBeNull();
    expect(libraryFileProblem("", "contrato.docx", MB)).toBeNull();
  });

  it("rechaza ejecutables, comprimidos, SVG y HTML", () => {
    expect(libraryFileProblem("application/zip", "a.zip", MB)?.code).toBe("unsupported_type");
    expect(libraryFileProblem("application/octet-stream", "setup.exe", MB)?.code).toBe("unsupported_type");
    expect(libraryFileProblem("image/svg+xml", "logo.svg", MB)?.message).toMatch(/SVG/);
    expect(libraryFileProblem("text/plain", "truco.html", MB)?.message).toMatch(/HTML/);
  });

  it("más de 100 MB → too_large con el tamaño", () => {
    expect(libraryFileProblem("application/pdf", "a.pdf", 101 * MB)).toEqual({
      code: "too_large",
      message: "El archivo pesa 101 MB y el máximo es 100 MB.",
    });
  });
});

describe("mensajes", () => {
  it("formatSize", () => {
    expect(formatSize(4.34 * MB)).toBe("4.3 MB");
    expect(formatSize(16 * MB)).toBe("16 MB");
    expect(formatSize(850 * 1024)).toBe("850 KB");
  });

  it("respuestas del proxy sin nuestro JSON", () => {
    expect(uploadHttpMessage(413)).toMatch(/demasiado grande/);
    expect(uploadHttpMessage(504)).toMatch(/tardó demasiado/);
    expect(uploadHttpMessage(500)).toBeNull();
  });
});

/** Un multipart como stream, SIN content-length (como un envío «chunked»). */
function multipart(size: number): Request {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(size)]), "a.pdf");
  const encoded = new Response(form);
  return new Request("http://localhost/subir", {
    method: "POST",
    headers: { "content-type": encoded.headers.get("content-type")! },
    body: encoded.body,
    duplex: "half",
  } as RequestInit);
}

describe("readUploadForm", () => {
  const tooLarge = () => Response.json({ error: { code: "too_large" } }, { status: 413 });

  it("lee un archivo dentro del tope", async () => {
    const r = await readUploadForm(multipart(1000), 10_000, tooLarge);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.form.get("file") as File).size).toBe(1000);
  });

  it("content-length mayor al tope → 413 sin leer el cuerpo", async () => {
    const req = new Request("http://localhost/subir", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(200 * MB) },
      body: "nada",
    });
    const r = await readUploadForm(req, 100 * MB, tooLarge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(413);
    // El cuerpo quedó sin tocar.
    expect(req.bodyUsed).toBe(false);
  });

  it("sin content-length, corta al pasar el tope mientras llega", async () => {
    const r = await readUploadForm(multipart(200 * 1024), 1024, tooLarge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(413);
  });

  it("cuerpo que no es multipart → 400", async () => {
    const req = new Request("http://localhost/subir", { method: "POST", body: "hola", headers: { "content-type": "text/plain" } });
    const r = await readUploadForm(req, 1024, tooLarge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });
});

describe("withUploadSlot", () => {
  function heavy(): Request {
    return new Request("http://localhost/subir", {
      method: "POST",
      headers: { "content-length": String(50 * MB) },
      body: "x",
    });
  }

  it(`a lo más ${MAX_HEAVY_UPLOADS} pesadas a la vez; la siguiente recibe 503 y luego se libera`, async () => {
    const releases: Array<() => void> = [];
    const running = Array.from({ length: MAX_HEAVY_UPLOADS }, () =>
      withUploadSlot(heavy(), () => new Promise<Response>((resolve) => releases.push(() => resolve(new Response("ok")))))
    );
    await Promise.resolve();
    expect(heavyUploadsInFlight()).toBe(MAX_HEAVY_UPLOADS);
    const busy = await withUploadSlot(heavy(), async () => new Response("ok"));
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("30");
    expect(((await busy.json()) as { error: { message: string } }).error.message).toMatch(/en un minuto/);
    // Las chicas no hacen fila.
    const chica = new Request("http://localhost/subir", { method: "POST", headers: { "content-length": "100" }, body: "x" });
    expect((await withUploadSlot(chica, async () => new Response("ok"))).status).toBe(200);
    releases.forEach((r) => r());
    await Promise.all(running);
    expect(heavyUploadsInFlight()).toBe(0);
  });

  it("libera el lugar aunque la subida falle", async () => {
    await expect(withUploadSlot(heavy(), async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(heavyUploadsInFlight()).toBe(0);
  });
});
