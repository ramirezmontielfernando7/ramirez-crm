import { describe, expect, it } from "vitest";
import { consentFromForm } from "@/server/contacts-io/consent-form";
import { optOutCsvRows, parseConsentAnswer, parseOptOutTreatment } from "@/lib/import-consent";
import { toCsv } from "@/lib/csv";

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("consentimiento al importar — formulario", () => {
  it("sin responder la pregunta → 422 consent_required", async () => {
    const r = consentFromForm({ role: "owner" }, form({}));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(422);
      expect((await r.response.json()).error.code).toBe("consent_required");
    }
  });

  it("sin tratamiento → respetar", () => {
    expect(consentFromForm({ role: "coordinador" }, form({ consentAnswer: "yes" }))).toEqual({
      ok: true,
      answer: "yes",
      treatment: "respect",
    });
  });

  it("tratamiento inválido → 422", () => {
    const r = consentFromForm({ role: "owner" }, form({ consentAnswer: "yes", optOutTreatment: "quiza" }));
    expect(!r.ok && r.response.status).toBe(422);
  });

  it("reactivar o pasar a desconocido: Propietario y Coordinador sí; Asesor 403", () => {
    for (const t of ["opt_in", "desconocido"]) {
      expect(consentFromForm({ role: "owner" }, form({ consentAnswer: "unknown", optOutTreatment: t })).ok).toBe(true);
      expect(consentFromForm({ role: "coordinador" }, form({ consentAnswer: "unknown", optOutTreatment: t })).ok).toBe(true);
      const asesor = consentFromForm({ role: "asesor" }, form({ consentAnswer: "unknown", optOutTreatment: t }));
      expect(!asesor.ok && asesor.response.status).toBe(403);
    }
    expect(consentFromForm({ role: "asesor" }, form({ consentAnswer: "yes", optOutTreatment: "respect" })).ok).toBe(true);
  });

  it("parsers estrictos", () => {
    expect(parseConsentAnswer("yes")).toBe("yes");
    expect(parseConsentAnswer("si")).toBeNull();
    expect(parseOptOutTreatment("opt_out")).toBeNull();
  });

  it("la lista descargable de bajas trae nombre, teléfono y fecha, protegida contra fórmulas", () => {
    const { header, rows } = optOutCsvRows([
      { line: 2, name: "=HYPERLINK(\"x\")", phone: "524621", since: "2026-09-01T12:00:00.000Z", source: "BAJA" },
    ]);
    expect(header).toEqual(["linea", "nombre", "telefono", "baja_desde", "origen_de_la_baja"]);
    expect(rows[0]).toEqual(["2", "=HYPERLINK(\"x\")", "524621", "2026-09-01", "BAJA"]);
    expect(toCsv(header, rows)).toContain("'=HYPERLINK");
  });
});
