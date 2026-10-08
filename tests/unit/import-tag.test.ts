import { describe, expect, it } from "vitest";
import { collectImportTagNames, parseExtraTagFields, tagIdsForMember } from "@/lib/import-tag";

describe("etiqueta para todos los contactos de la base", () => {
  it("vacío = sin etiqueta extra (todo como hoy)", () => {
    expect(parseExtraTagFields({})).toEqual({ ok: true, tag: null });
    expect(parseExtraTagFields({ id: "", name: "   ", color: "" })).toEqual({ ok: true, tag: null });
  });

  it("una existente va por id; el id manda sobre el nombre", () => {
    expect(parseExtraTagFields({ id: "tag_1", name: "Otra" })).toEqual({
      ok: true,
      tag: { kind: "existing", id: "tag_1" },
    });
  });

  it("una nueva normaliza el nombre y valida el color como createTag", () => {
    expect(parseExtraTagFields({ name: "  Referido   VIP ", color: "verde" })).toEqual({
      ok: true,
      tag: { kind: "new", name: "Referido VIP", color: "verde" },
    });
    expect(parseExtraTagFields({ name: "Referido" })).toEqual({
      ok: true,
      tag: { kind: "new", name: "Referido", color: null },
    });
    expect(parseExtraTagFields({ name: "x".repeat(61) }).ok).toBe(false);
    expect(parseExtraTagFields({ name: "Referido", color: "fucsia" }).ok).toBe(false);
  });

  it("junta la automática y las de cada fila sin repetir", () => {
    expect(collectImportTagNames("Import: a.xlsx", [["VIP"], ["VIP", "Zona 1"], []])).toEqual([
      "Import: a.xlsx",
      "VIP",
      "Zona 1",
    ]);
  });

  it("las etiquetas de un contacto se SUMAN: automática + filas + extra, sin duplicar", () => {
    expect(tagIdsForMember("auto", ["vip", "auto"], "ref")).toEqual(["auto", "vip", "ref"]);
    expect(tagIdsForMember("auto", ["vip"], "vip")).toEqual(["auto", "vip"]);
    expect(tagIdsForMember("auto", [], null)).toEqual(["auto"]);
  });
});

import { extraTagFromForm } from "@/server/contacts-io/extra-tag-form";

describe("permiso para crear la etiqueta al importar", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("crear una nueva sin tags.manage → 403 (elegir una existente no lo pide)", () => {
    const asesor = { role: "asesor", grants: [] } as never;
    const nueva = extraTagFromForm(asesor, form({ extraTagName: "Referido" }));
    expect(nueva.ok).toBe(false);
    if (!nueva.ok) expect(nueva.response.status).toBe(403);
    expect(extraTagFromForm(asesor, form({ extraTagId: "tag_1" })).ok).toBe(true);
    expect(extraTagFromForm(asesor, form({})).ok).toBe(true);
  });

  it("con tags.manage (Propietario, Coordinador) puede crearla; nombre inválido → 422", () => {
    for (const role of ["owner", "coordinador"]) {
      const r = extraTagFromForm({ role, grants: [] } as never, form({ extraTagName: "Referido", extraTagColor: "azul" }));
      expect(r).toMatchObject({ ok: true, tag: { kind: "new", name: "Referido", color: "azul" } });
    }
    const mala = extraTagFromForm({ role: "owner", grants: [] } as never, form({ extraTagName: "x".repeat(61) }));
    expect(mala.ok).toBe(false);
    if (!mala.ok) expect(mala.response.status).toBe(422);
  });
});
