import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkWhatsAppSignature,
  isValidSignature,
  isValidWebhookToken,
  safeEqual,
} from "@/server/inbox/webhook";

describe("capa 1: token en la ruta (FR-041/FR-083)", () => {
  it("segmento correcto → válido", () => {
    expect(isValidWebhookToken("token-abc", "token-abc")).toBe(true);
  });

  it("segmento incorrecto → inválido (la ruta responde 404)", () => {
    expect(isValidWebhookToken("token-xyz", "token-abc")).toBe(false);
  });

  it("verify token vacío jamás valida", () => {
    expect(isValidWebhookToken("", "")).toBe(false);
  });
});

describe("capa 2: firma x-hub-signature-256 (FR-042)", () => {
  const secret = "app-secret-de-prueba";
  const body = JSON.stringify({ object: "whatsapp_business_account" });

  function sign(payload: string, key: string): string {
    return `sha256=${createHmac("sha256", key).update(payload, "utf8").digest("hex")}`;
  }

  it("firma válida → pasa", () => {
    expect(isValidSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("firma inválida → rechaza (la ruta responde 401)", () => {
    expect(isValidSignature(body, sign(body, "otro-secreto"), secret)).toBe(
      false
    );
  });

  it("firma de otro body → rechaza", () => {
    expect(isValidSignature("{}", sign(body, secret), secret)).toBe(false);
  });

  it("header ausente con secreto configurado → rechaza", () => {
    expect(isValidSignature(body, null, secret)).toBe(false);
  });

  it("sin secreto configurado la capa está desactivada → pasa (Instagram y Messenger)", () => {
    expect(isValidSignature(body, null, undefined)).toBe(true);
    expect(isValidSignature(body, "sha256=basura", undefined)).toBe(true);
  });
});

describe("checkWhatsAppSignature (H7: obligatoria)", () => {
  const secret = "app-secret-de-prueba";
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const sign = (payload: string, key: string) =>
    `sha256=${createHmac("sha256", key).update(payload, "utf8").digest("hex")}`;
  const prod = { allowUnsignedDev: false };
  const dev = { allowUnsignedDev: true };

  it("sin secreto → rechaza con missing_secret, con o sin firma", () => {
    expect(checkWhatsAppSignature(body, null, undefined, prod)).toEqual({ ok: false, reason: "missing_secret" });
    expect(checkWhatsAppSignature(body, "sha256=basura", undefined, prod)).toEqual({
      ok: false,
      reason: "missing_secret",
    });
    expect(checkWhatsAppSignature(body, null, "", prod)).toEqual({ ok: false, reason: "missing_secret" });
  });

  it("sin secreto y con la salida de desarrollo → acepta", () => {
    expect(checkWhatsAppSignature(body, null, undefined, dev)).toEqual({ ok: true });
  });

  it("con secreto se verifica siempre, aunque la salida de desarrollo esté encendida", () => {
    for (const opts of [prod, dev]) {
      expect(checkWhatsAppSignature(body, sign(body, secret), secret, opts)).toEqual({ ok: true });
      expect(checkWhatsAppSignature(body, null, secret, opts)).toEqual({ ok: false, reason: "bad_signature" });
      expect(checkWhatsAppSignature(body, sign(body, "otro"), secret, opts)).toEqual({
        ok: false,
        reason: "bad_signature",
      });
    }
  });
});

describe("safeEqual", () => {
  it("longitudes distintas no lanzan", () => {
    expect(safeEqual("a", "aa")).toBe(false);
  });
});
