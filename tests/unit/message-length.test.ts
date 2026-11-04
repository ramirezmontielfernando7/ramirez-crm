import { describe, expect, it } from "vitest";
import { CHAT_TEXT_MAX, DIRECT_TEXT_MAX, META_TEXT_MAX, splitForMeta } from "@/lib/message-length";
import { TEAM_MESSAGE_MAX } from "@/lib/team-chat";

describe("largo de los mensajes", () => {
  it("límites: Meta 4,096; dispositivo y chats 65,536; equipo 20,000", () => {
    expect(META_TEXT_MAX).toBe(4096);
    expect(DIRECT_TEXT_MAX).toBe(65536);
    expect(CHAT_TEXT_MAX).toBe(65536);
    expect(TEAM_MESSAGE_MAX).toBe(20000);
  });

  it("un texto que cabe sale tal cual (sin espacios de los extremos)", () => {
    expect(splitForMeta("  Hola  ")).toEqual(["Hola"]);
    expect(splitForMeta("a".repeat(4096))).toEqual(["a".repeat(4096)]);
    expect(splitForMeta("   ")).toEqual([]);
  });

  it("corta en el último párrafo que quepa", () => {
    const p1 = "a".repeat(60);
    const p2 = "b".repeat(30);
    const p3 = "c".repeat(30);
    expect(splitForMeta(`${p1}\n\n${p2}\n\n${p3}`, 100)).toEqual([`${p1}\n\n${p2}`, p3]);
  });

  it("sin párrafos, corta al final de una frase y deja el punto arriba", () => {
    const text = `${"Uno dos tres. ".repeat(10)}Fin`;
    const parts = splitForMeta(text, 50);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(50);
      expect(p === parts.at(-1) || p.endsWith(".")).toBe(true);
    }
    expect(parts.join(" ")).toBe(text.trim());
  });

  it("sin separadores corta en seco sin partir un emoji", () => {
    const text = "x".repeat(9) + "😀" + "y".repeat(10);
    const parts = splitForMeta(text, 10);
    expect(parts[0]).toBe("x".repeat(9));
    expect(parts.join("")).toBe(text);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(10);
  });

  it("un texto de 65,536 sale en partes de máximo 4,096 y conserva todo", () => {
    const words = "palabra ".repeat(8192).trim();
    const parts = splitForMeta(words);
    expect(parts.length).toBeGreaterThanOrEqual(16);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(META_TEXT_MAX);
    expect(parts.join(" ")).toBe(words);
  });
});
