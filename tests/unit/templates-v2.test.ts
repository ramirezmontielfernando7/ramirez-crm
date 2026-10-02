import { describe, expect, it } from "vitest";
import {
  bodyFromComponents,
  buildTemplateComponents,
  sendRequirements,
  validateTemplateDraft,
  type TemplateDraft,
} from "@/lib/templates";
import { mapMetaStatus } from "@/server/whatsapp/templates";

const base: TemplateDraft = {
  name: "promo",
  language: "es_MX",
  category: "MARKETING",
  body: "Hola {{1}}, tu cupón es {{2}}",
  bodyExamples: ["Ana", "PROMO10"],
  header: { format: "NONE" },
  footer: null,
  buttons: [],
};

describe("plantillas v2: borrador", () => {
  it("pide un ejemplo por variable", () => {
    expect(validateTemplateDraft(base)).toBeNull();
    expect(validateTemplateDraft({ ...base, bodyExamples: ["Ana"] })).toMatch(/ejemplo/);
    expect(validateTemplateDraft({ ...base, bodyExamples: ["Ana", "  "] })).toMatch(/ejemplo/);
  });

  it("encabezado de texto sin variables; pie sin variables; URL fija y válida", () => {
    expect(validateTemplateDraft({ ...base, header: { format: "TEXT", text: "Hola {{1}}" } })).toMatch(/encabezado/);
    expect(validateTemplateDraft({ ...base, header: { format: "TEXT", text: "" } })).toMatch(/encabezado/);
    expect(validateTemplateDraft({ ...base, footer: "x {{1}}" })).toMatch(/pie/);
    expect(validateTemplateDraft({ ...base, buttons: [{ type: "URL", text: "Ver", url: "https://x.com/{{1}}" }] })).toMatch(/fija/);
    expect(validateTemplateDraft({ ...base, buttons: [{ type: "URL", text: "Ver", url: "notaurl" }] })).toMatch(/no es válida/);
    expect(validateTemplateDraft({ ...base, buttons: [{ type: "QUICK_REPLY", text: " " }] })).toMatch(/texto/);
  });

  it("arma los componentes de Meta", () => {
    const c = buildTemplateComponents(
      {
        ...base,
        header: { format: "IMAGE" },
        footer: "Responde BAJA",
        buttons: [
          { type: "QUICK_REPLY", text: "Me interesa" },
          { type: "URL", text: "Ver", url: "https://ejemplo.com" },
        ],
      },
      "HANDLE"
    );
    expect(c).toEqual([
      { type: "HEADER", format: "IMAGE", example: { header_handle: ["HANDLE"] } },
      { type: "BODY", text: base.body, example: { body_text: [["Ana", "PROMO10"]] } },
      { type: "FOOTER", text: "Responde BAJA" },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Me interesa" },
          { type: "URL", text: "Ver", url: "https://ejemplo.com" },
        ],
      },
    ]);
    expect(bodyFromComponents(c)).toBe(base.body);
  });
});

describe("plantillas v2: qué necesita el envío", () => {
  it("texto e imagen se envían; variable en encabezado o URL, no", () => {
    expect(sendRequirements([{ type: "BODY", text: "x" }])).toEqual({ headerImage: false, unsupported: null });
    expect(sendRequirements([{ type: "HEADER", format: "IMAGE" }]).headerImage).toBe(true);
    expect(sendRequirements([{ type: "HEADER", format: "TEXT", text: "Hola {{1}}" }]).unsupported).toMatch(/variable/);
    expect(sendRequirements([{ type: "HEADER", format: "VIDEO" }]).unsupported).toMatch(/VIDEO/);
    expect(
      sendRequirements([{ type: "BUTTONS", buttons: [{ type: "URL", text: "x", url: "https://a.com/{{1}}" }] }]).unsupported
    ).toMatch(/URL/);
    expect(sendRequirements([{ type: "BUTTONS", buttons: [{ type: "COPY_CODE", text: "x" }] }]).unsupported).toMatch(/COPY_CODE/);
    expect(sendRequirements(null)).toEqual({ headerImage: false, unsupported: null });
  });

  it("estados de Meta → locales: PAUSED sigue aprobada (bloqueada aparte), DISABLED rechazada", () => {
    expect(mapMetaStatus("APPROVED")).toBe("approved");
    expect(mapMetaStatus("PAUSED")).toBe("approved");
    expect(mapMetaStatus("DISABLED")).toBe("rejected");
    expect(mapMetaStatus("IN_APPEAL")).toBe("pending");
    expect(mapMetaStatus("ALGO_NUEVO")).toBeNull();
  });
});
