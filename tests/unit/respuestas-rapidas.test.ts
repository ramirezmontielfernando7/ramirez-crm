import { describe, expect, it } from "vitest";
import { fillQuickReply, filterQuickReplies, normalizeShortcut, quickReplySchema, slashQuery } from "@/lib/quick-replies";

const R = (shortcut: string, body: string) => ({ id: shortcut, shortcut, body });

describe("respuestas rápidas — reglas puras", () => {
  it("el atajo se escribe en minúsculas, sin acentos ni espacios", () => {
    expect(normalizeShortcut("  /Precios Año 2026 ")).toBe("precios-ano-2026");
    expect(normalizeShortcut("¿Horario?")).toBe("horario");
    expect(normalizeShortcut("x".repeat(40))).toHaveLength(30);
  });

  it("`/` solo es comando al inicio y sin espacios", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/Pre")).toBe("pre");
    expect(slashQuery("/pre cios")).toBeNull();
    expect(slashQuery("hola /pre")).toBeNull();
    expect(slashQuery("")).toBeNull();
  });

  it("primero las que empiezan con lo escrito, luego las que lo contienen", () => {
    const list = [R("cuenta", "Te paso los precios"), R("precios", "Lista"), R("horario", "9 a 6")];
    expect(filterQuickReplies(list, "pre").map((r) => r.shortcut)).toEqual(["precios", "cuenta"]);
    expect(filterQuickReplies(list, "").map((r) => r.shortcut)).toEqual(["cuenta", "precios", "horario"]);
    expect(filterQuickReplies(list, "zzz")).toEqual([]);
  });

  it("{nombre} se cambia por el primer nombre (un teléfono no es nombre)", () => {
    expect(fillQuickReply("Hola {nombre}, ¿cómo estás?", "Laura Méndez")).toBe("Hola Laura, ¿cómo estás?");
    expect(fillQuickReply("Hola { Nombre }!", "Ana")).toBe("Hola Ana!");
    expect(fillQuickReply("Hola {nombre}, bienvenido", "+5219981112233")).toBe("Hola, bienvenido");
    expect(fillQuickReply("Sin variable", null)).toBe("Sin variable");
  });

  it("la API exige atajo válido y mensaje", () => {
    expect(quickReplySchema.safeParse({ shortcut: "precios", body: "x" }).success).toBe(true);
    expect(quickReplySchema.safeParse({ shortcut: "Precios", body: "x" }).success).toBe(false);
    expect(quickReplySchema.safeParse({ shortcut: "a b", body: "x" }).success).toBe(false);
    expect(quickReplySchema.safeParse({ shortcut: "ok", body: "   " }).success).toBe(false);
  });
});
