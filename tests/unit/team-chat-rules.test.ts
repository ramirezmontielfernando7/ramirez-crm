import { describe, expect, it } from "vitest";
import {
  attachmentRejection,
  canPost,
  canReact,
  directKey,
  isInlineImage,
  isReactionEmoji,
  resolveRelation,
  totalUnread,
} from "@/lib/team-chat";

/** 025 — Reglas puras del chat de equipo: quién ve, quién escribe, qué se sube. */

describe("quién ve un hilo", () => {
  const base = { isParticipant: false, canOversee: false, oversightOn: false };

  it("avisos: todo miembro de la organización participa", () => {
    expect(resolveRelation({ ...base, kind: "announcements" })).toBe("member");
  });

  it("directo o grupo: participa solo quien está dentro", () => {
    expect(resolveRelation({ ...base, kind: "direct", isParticipant: true })).toBe("member");
    expect(resolveRelation({ ...base, kind: "direct" })).toBeNull();
    expect(resolveRelation({ ...base, kind: "group" })).toBeNull();
  });

  it("el Propietario con la supervisión ENCENDIDA ve los ajenos como supervisor", () => {
    expect(resolveRelation({ ...base, kind: "direct", canOversee: true, oversightOn: true })).toBe("oversight");
  });

  it("con la supervisión APAGADA, el Propietario no ve directos ajenos", () => {
    expect(resolveRelation({ ...base, kind: "direct", canOversee: true, oversightOn: false })).toBeNull();
    expect(resolveRelation({ ...base, kind: "group", canOversee: true, oversightOn: false })).toBeNull();
  });

  it("sin el permiso de supervisar, el ajuste encendido no da nada (Coordinador con scope.all)", () => {
    expect(resolveRelation({ ...base, kind: "direct", canOversee: false, oversightOn: true })).toBeNull();
  });
});

describe("quién escribe y reacciona", () => {
  it("la supervisión nunca escribe ni reacciona", () => {
    expect(canPost("oversight", "direct", true)).toBe(false);
    expect(canPost("oversight", "group", true)).toBe(false);
    expect(canReact("oversight")).toBe(false);
  });

  it("en avisos publica solo quien puede anunciar; todos reaccionan", () => {
    expect(canPost("member", "announcements", false)).toBe(false);
    expect(canPost("member", "announcements", true)).toBe(true);
    expect(canReact("member")).toBe(true);
  });

  it("en directos y grupos escribe quien participa", () => {
    expect(canPost("member", "direct", false)).toBe(true);
    expect(canPost("member", "group", false)).toBe(true);
    expect(canPost(null, "group", true)).toBe(false);
  });
});

describe("no leídos", () => {
  it("la supervisión no suma al badge", () => {
    expect(
      totalUnread([
        { relation: "member", unread: 2 },
        { relation: "oversight", unread: 7 },
        { relation: "member", unread: 1 },
      ])
    ).toBe(3);
  });
});

describe("adjuntos", () => {
  it("bloquea SVG y HTML por tipo y por extensión", () => {
    expect(attachmentRejection("image/svg+xml", "logo.svg", 10)).toMatch(/SVG/);
    expect(attachmentRejection("text/html", "a.html", 10)).toMatch(/HTML/);
    expect(attachmentRejection("application/xhtml+xml", "a.xhtml", 10)).toMatch(/HTML/);
    // El tipo miente pero la extensión no.
    expect(attachmentRejection("application/octet-stream", "truco.svg", 10)).toMatch(/SVG/);
    expect(attachmentRejection("text/plain", "pagina.htm", 10)).toMatch(/HTML/);
  });

  it("acepta documentos e imágenes dentro del tope", () => {
    expect(attachmentRejection("application/pdf", "cotizacion.pdf", 1000)).toBeNull();
    expect(attachmentRejection("image/png", "foto.png", 1000)).toBeNull();
    expect(attachmentRejection("application/pdf", "grande.pdf", 17 * 1024 * 1024)).toMatch(/16 MB/);
    expect(attachmentRejection("application/pdf", "vacio.pdf", 0)).toMatch(/vacío/);
  });

  it("solo las imágenes raster se muestran en línea", () => {
    for (const m of ["image/jpeg", "image/png", "image/webp", "image/gif"]) expect(isInlineImage(m)).toBe(true);
    for (const m of ["image/svg+xml", "application/pdf", "text/html", "image/bmp"]) expect(isInlineImage(m)).toBe(false);
  });
});

describe("varios", () => {
  it("un directo por par, sin importar quién lo abre", () => {
    expect(directKey("usr_b", "usr_a")).toBe(directKey("usr_a", "usr_b"));
  });

  it("una reacción es un emoji corto", () => {
    expect(isReactionEmoji("👍")).toBe(true);
    expect(isReactionEmoji("❤️")).toBe(true);
    expect(isReactionEmoji("hola")).toBe(false);
    expect(isReactionEmoji("")).toBe(false);
    expect(isReactionEmoji("<script>")).toBe(false);
  });
});
