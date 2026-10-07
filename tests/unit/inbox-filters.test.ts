import { describe, expect, it } from "vitest";
import {
  ALL_TAGS,
  canDeleteConversation,
  inArchiveView,
  isArchived,
  matchesTag,
} from "@/lib/inbox-filters";

const tag = (id: string) => ({ id, name: id, color: null });

describe("034 — eliminar chats: quién puede", () => {
  it("Propietario y Coordinador sí; Asesor no", () => {
    expect(canDeleteConversation({ role: "owner" })).toBe(true);
    expect(canDeleteConversation({ role: "coordinador" })).toBe(true);
    expect(canDeleteConversation({ role: "asesor" })).toBe(false);
  });
  it("falla cerrado con un rol desconocido o en inglés", () => {
    for (const role of ["member", "", "coordinator", "OWNER"]) {
      expect(canDeleteConversation({ role })).toBe(false);
    }
  });
});

describe("034 — filtro por etiqueta", () => {
  const vip = { tags: [tag("vip"), tag("alumno")] };
  const ninguna = { tags: [] };

  it("«Toda etiqueta» (valor por defecto) deja pasar todo", () => {
    expect(matchesTag(vip, ALL_TAGS)).toBe(true);
    expect(matchesTag(ninguna, ALL_TAGS)).toBe(true);
    expect(matchesTag(ninguna, "")).toBe(true);
  });
  it("con una etiqueta elegida deja solo a quien la lleva", () => {
    expect(matchesTag(vip, "vip")).toBe(true);
    expect(matchesTag(vip, "alumno")).toBe(true);
    expect(matchesTag(vip, "otra")).toBe(false);
    expect(matchesTag(ninguna, "vip")).toBe(false);
  });
});

describe("034 — archivados", () => {
  const viva = { archivedAt: null };
  const archivada = { archivedAt: "2026-10-07T10:00:00.000Z" };

  it("isArchived", () => {
    expect(isArchived(viva)).toBe(false);
    expect(isArchived(archivada)).toBe(true);
  });
  it("la Bandeja principal oculta las archivadas; «Archivados» muestra solo ellas", () => {
    expect(inArchiveView(viva, false)).toBe(true);
    expect(inArchiveView(archivada, false)).toBe(false);
    expect(inArchiveView(viva, true)).toBe(false);
    expect(inArchiveView(archivada, true)).toBe(true);
  });
});
