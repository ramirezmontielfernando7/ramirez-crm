import { describe, expect, it } from "vitest";
import { GENERAL_GROUP_KEY, GROUP_NAME_MAX, groupIdFromKey, groupKey, normalizeGroupName } from "@/lib/kb-docs";

/** 037 — Reglas puras de los grupos de documentos. */
describe("037 — nombre de un grupo", () => {
  it("limpia espacios", () => {
    expect(normalizeGroupName("  Ventas   y  cobranza ")).toEqual({ ok: true, name: "Ventas y cobranza" });
  });

  it("vacío, demasiado largo o no-texto: inválido", () => {
    expect(normalizeGroupName("   ")).toEqual({ ok: false, code: "group_name_invalid" });
    expect(normalizeGroupName("x".repeat(GROUP_NAME_MAX + 1))).toEqual({ ok: false, code: "group_name_invalid" });
    expect(normalizeGroupName("x".repeat(GROUP_NAME_MAX))).toMatchObject({ ok: true });
    expect(normalizeGroupName(42)).toEqual({ ok: false, code: "group_name_invalid" });
  });

  it("«General» está reservado (mayúsculas y acentos dan igual)", () => {
    for (const n of ["General", "general", " GENERAL ", "Géneral"]) {
      expect(normalizeGroupName(n)).toEqual({ ok: false, code: "group_name_reserved" });
    }
    expect(normalizeGroupName("Generales")).toMatchObject({ ok: true });
  });
});

describe("037 — clave de la pestaña", () => {
  it("General es group_id NULL", () => {
    expect(groupKey(null)).toBe(GENERAL_GROUP_KEY);
    expect(groupIdFromKey(GENERAL_GROUP_KEY)).toBeNull();
    expect(groupIdFromKey("kdg_abc")).toBe("kdg_abc");
    expect(groupKey("kdg_abc")).toBe("kdg_abc");
  });
});
