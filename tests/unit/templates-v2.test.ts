import { describe, expect, it } from "vitest";
import {
  bodyFromComponents,
  buildTemplateComponents,
  sendRequirements,
  validateTemplateDraft,
  type TemplateDraft,
} from "@/lib/templates";
import { mapMetaStatus, parseTemplateCategoryEvent, sameJson, templateSendability } from "@/server/whatsapp/templates";

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

describe("plantillas v2: comparación de componentes", () => {
  it("no depende del orden de las llaves (jsonb las reordena)", () => {
    expect(sameJson([{ type: "BODY", text: "x", example: { a: 1 } }], [{ example: { a: 1 }, text: "x", type: "BODY" }])).toBe(true);
    expect(sameJson([{ type: "BODY", text: "x" }], [{ type: "BODY", text: "y" }])).toBe(false);
    expect(sameJson(null, undefined)).toBe(true);
  });
});

describe("plantillas v2: webhook template_category_update", () => {
  it("cambio próximo: new_category es la ACTUAL y correct_category la futura", () => {
    expect(
      parseTemplateCategoryEvent({ new_category: "utility", correct_category: "MARKETING", category_update_timestamp: 1790000000 })
    ).toEqual({ kind: "upcoming", current: "UTILITY", upcoming: "MARKETING", at: new Date(1790000000 * 1000) });
    expect(parseTemplateCategoryEvent({ new_category: "UTILITY", correct_category: "MARKETING" })).toMatchObject({
      kind: "upcoming",
      at: null,
    });
  });

  it("cambio hecho: previous_category + new_category (la nueva real)", () => {
    expect(parseTemplateCategoryEvent({ previous_category: "UTILITY", new_category: "MARKETING" })).toEqual({
      kind: "changed",
      previous: "UTILITY",
      current: "MARKETING",
    });
  });

  it("old_category no existe: se ignora", () => {
    expect(parseTemplateCategoryEvent({ old_category: "UTILITY", new_category: "MARKETING" })).toEqual({
      kind: "changed",
      previous: null,
      current: "MARKETING",
    });
  });

  it("sin new_category no hay nada que aplicar", () => {
    expect(parseTemplateCategoryEvent({ correct_category: "MARKETING" })).toBeNull();
  });
});

describe("plantillas v2: estados de Meta desconocidos", () => {
  const base = {
    status: "approved",
    metaStatus: "APPROVED",
    pausedReason: null,
    components: [{ type: "BODY", text: "Hola" }],
    headerMediaAssetId: null,
  } as unknown as Parameters<typeof templateSendability>[0];

  it("UNARCHIVED, FLAGGED, LOCKED o REINSTATED no rompen nada ni bloquean el envío", () => {
    for (const metaStatus of ["UNARCHIVED", "FLAGGED", "LOCKED", "REINSTATED"]) {
      expect(mapMetaStatus(metaStatus)).toBeNull();
      expect(templateSendability({ ...base, metaStatus }).sendable).toBe(true);
    }
  });

  it("los que se sabe que impiden enviar sí bloquean", () => {
    expect(templateSendability({ ...base, metaStatus: "PAUSED" }).sendable).toBe(false);
    expect(templateSendability({ ...base, metaStatus: "DISABLED" }).sendable).toBe(false);
  });
});
