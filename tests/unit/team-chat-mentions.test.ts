import { describe, expect, it } from "vitest";
import {
  encodeMentions,
  extractMentionIds,
  extractUserMentionIds,
  mentionToken,
  userMentionRef,
  userMentionToken,
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

  it("compañeros: se extraen aparte de los chats, sin repetir", () => {
    const U = "AbC123xyz_-9";
    const mixto = `Hola ${userMentionToken(U)}, mira ${mentionToken(A)} ${userMentionToken(U)}`;
    expect(extractUserMentionIds(mixto)).toEqual([U]);
    expect(extractMentionIds(mixto)).toEqual([A]);
  });

  it("compañeros y chats comparten la numeración de posiciones", () => {
    const U = "user0001";
    const mixto = `${userMentionToken(U)} revisa ${mentionToken(A)}`;
    const r = renderMentions(mixto, new Map([[A, { contactId: "ct_a", label: "Clínica Polanco" }]]), new Map([[U, "Ana López"]]));
    expect(r.body).toBe("@[m:0] revisa @[m:1]");
    expect(r.mentions).toEqual([
      { accessible: true, kind: "user", userId: U, label: "Ana López" },
      { accessible: true, conversationId: A, contactId: "ct_a", label: "Clínica Polanco" },
    ]);
  });

  it("un compañero que ya no es del equipo sale sin nombre", () => {
    const r = renderMentions(`hola ${userMentionToken("ex0001")}`, new Map());
    expect(r.mentions).toEqual([{ accessible: false }]);
  });

  it("el editor codifica compañeros (`user:<id>`) y chats en el mismo mapa", () => {
    const text = "@{Ana López} mira @{Clínica Polanco}";
    expect(encodeMentions(text, new Map([["Ana López", userMentionRef("u1")], ["Clínica Polanco", A]]))).toBe(
      `${userMentionToken("u1")} mira ${mentionToken(A)}`
    );
  });

  it("la vista previa no lleva el id del compañero", () => {
    expect(previewWithoutMentions(`hola ${userMentionToken("u1")}`)).toBe("hola @compañero");
  });
});
