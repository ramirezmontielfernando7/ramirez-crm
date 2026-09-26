import { describe, expect, it } from "vitest";
import {
  encodeMentions,
  extractMentionIds,
  mentionToken,
  previewWithoutMentions,
  renderMentions,
  splitBody,
} from "@/lib/team-chat-mentions";

/**
 * 026 — Menciones de chats de cliente en el chat de equipo. La regla que
 * importa: a quien NO puede ver el chat mencionado no le llega nada de él —
 * ni el nombre, ni el id (criterio 404).
 */

const A = "cv_aaaaaaaaaaaaaaaaaaaa";
const B = "cv_bbbbbbbbbbbbbbbbbbbb";
const body = `Revisen ${mentionToken(A)} y también ${mentionToken(B)}; otra vez ${mentionToken(A)}`;

describe("menciones", () => {
  it("se extraen sin repetir y en orden", () => {
    expect(extractMentionIds(body)).toEqual([A, B]);
  });

  it("quien ve los dos chats recibe nombre y contacto de cada uno", () => {
    const r = renderMentions(
      body,
      new Map([
        [A, { contactId: "ct_a", label: "Clínica Polanco" }],
        [B, { contactId: "ct_b", label: "Dental Norte" }],
      ])
    );
    expect(r.body).toBe("Revisen @[m:0] y también @[m:1]; otra vez @[m:0]");
    expect(r.mentions).toEqual([
      { accessible: true, conversationId: A, contactId: "ct_a", label: "Clínica Polanco" },
      { accessible: true, conversationId: B, contactId: "ct_b", label: "Dental Norte" },
    ]);
  });

  it("quien NO ve un chat no recibe ni su nombre ni su id (tampoco en el texto)", () => {
    const r = renderMentions(body, new Map([[A, { contactId: "ct_a", label: "Clínica Polanco" }]]));
    expect(r.mentions[1]).toEqual({ accessible: false });
    const todo = JSON.stringify(r);
    expect(todo).not.toContain(B);
    expect(todo).not.toContain("Dental Norte");
    expect(todo).not.toContain("ct_b");
  });

  it("neutro (SSE): nadie resuelve nada y ningún id viaja", () => {
    const r = renderMentions(body, new Map());
    expect(r.mentions).toEqual([{ accessible: false }, { accessible: false }]);
    expect(JSON.stringify(r)).not.toMatch(/cv_[a-z]/);
  });

  it("la vista previa de la lista no lleva ids", () => {
    expect(previewWithoutMentions(body)).toBe("Revisen @chat y también @chat; otra vez @chat");
    expect(previewWithoutMentions("hola @[m:0]")).toBe("hola @chat");
  });

  it("se parte en texto y menciones para pintarlo", () => {
    const r = renderMentions(body, new Map());
    const parts = splitBody(r.body, r.mentions);
    expect(parts.map((p) => p.type)).toEqual(["text", "mention", "text", "mention", "text", "mention"]);
    // Un índice que no existe se pinta sin acceso, sin romper.
    expect(splitBody("x @[m:9]", [])[1]).toEqual({ type: "mention", mention: { accessible: false } });
  });

  it("el editor escribe @{Nombre} y se codifica al enviar", () => {
    const text = "Mira @{Clínica Polanco} y @{Dental Norte}";
    expect(encodeMentions(text, new Map([["Clínica Polanco", A], ["Dental Norte", B]]))).toBe(
      `Mira ${mentionToken(A)} y ${mentionToken(B)}`
    );
  });

  it("un id raro no se toma por mención (solo el formato de nanoid)", () => {
    expect(extractMentionIds("@[chat:../../x] @[chat:CV_MAYUS] @[chat:]")).toEqual([]);
  });
});
