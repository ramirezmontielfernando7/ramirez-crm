import { describe, expect, it, vi } from "vitest";

/**
 * 025 — Un adjunto del chat de equipo nunca se sirve como documento activo:
 * `nosniff` siempre, y `attachment` + octet-stream para todo lo que no sea
 * imagen raster (jpeg/png/webp/gif).
 */

const file = vi.hoisted(() => ({ mime: "application/pdf", name: "cotizacion.pdf" }));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({
    userId: "usr_a",
    organizationId: "org_a",
    role: "asesor",
    access: { organizationId: "org_a", userId: "usr_a", seesAll: false },
  }),
}));

vi.mock("@/server/team-chat/messages", () => ({
  readAttachment: async () => ({
    row: { mimeType: file.mime, fileName: file.name },
    data: Buffer.from("contenido"),
  }),
}));

import { GET } from "@/app/api/team-chat/attachments/[id]/route";

const ctx = { params: Promise.resolve({ id: "tca_x" }) };

describe("cabeceras del adjunto", () => {
  it.each([
    ["application/pdf", "cotizacion.pdf"],
    ["text/plain", "notas.txt"],
    ["application/zip", "fotos.zip"],
  ])("%s → descarga (attachment + octet-stream + nosniff)", async (mime, name) => {
    file.mime = mime;
    file.name = name;
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });

  it.each(["image/jpeg", "image/png", "image/webp", "image/gif"])("%s → en línea, con nosniff", async (mime) => {
    file.mime = mime;
    file.name = "foto";
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("content-type")).toBe(mime);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("un nombre con comillas o saltos no rompe la cabecera", async () => {
    file.mime = "application/pdf";
    file.name = 'a"b\r\nSet-Cookie: x.pdf';
    const res = await GET(new Request("http://localhost/x"), ctx);
    // Comillas y saltos se vuelven "_": el nombre queda dentro de sus comillas.
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="a_b__Set-Cookie_ x.pdf"');
  });
});
