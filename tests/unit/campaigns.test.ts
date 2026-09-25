import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { and } from "drizzle-orm";
import { firstName, resolveVariables } from "@/lib/campaigns";
import { audienceConditions } from "@/server/campaigns/audience";
import { parseCampaignsFlag } from "@/server/campaigns/flag";
import { classify } from "@/server/campaigns/runner";
import { SendError } from "@/server/inbox/send";
import { TemplateError } from "@/server/whatsapp/templates";
import { audienceSchema } from "@/server/campaigns/http";

const dialect = new PgDialect();
const sqlOf = (audience: Parameters<typeof audienceConditions>[0]) =>
  dialect.sqlToQuery(and(...audienceConditions(audience))!);

describe("021 — REGLA DURA: el público solo es opt_in", () => {
  it("toda consulta de público exige wa_consent = 'opt_in'", () => {
    for (const audience of [{}, { tagIds: ["tag_a"] }, { source: "anuncio" }]) {
      const q = sqlOf(audience);
      expect(q.sql).toMatch(/"contact"\."wa_consent" = \$\d+/);
      expect(q.params).toContain("opt_in");
      expect(q.params).not.toContain("desconocido");
      expect(q.params).not.toContain("opt_out");
    }
  });

  it("el cliente no puede pedir otro consentimiento: el esquema no lo acepta", () => {
    expect(audienceSchema.safeParse({ consent: "desconocido" }).success).toBe(false);
    expect(audienceSchema.safeParse({ tagIds: ["tag_a"] }).success).toBe(true);
  });

  it("excluye archivados, otros canales y contactos del Laboratorio", () => {
    const q = sqlOf({});
    expect(q.sql).toMatch(/"archived_at" is null/);
    expect(q.params).toContain("whatsapp");
    expect(q.sql).toMatch(/is_test/);
  });

  it("el ejecutor re-verifica el consentimiento al enviar (no solo al lanzar)", () => {
    const code = readFileSync(
      path.resolve(import.meta.dirname, "..", "..", "src", "server", "campaigns", "runner.ts"),
      "utf8"
    );
    expect(code).toMatch(/contact\.waConsent !== "opt_in"/);
  });
});

describe("021 — variables por destinatario", () => {
  it("texto fijo o nombre de pila", () => {
    expect(
      resolveVariables([{ kind: "contact_name" }, { kind: "fixed", value: "20%" }], "ANA MARÍA López")
    ).toEqual(["Ana", "20%"]);
    expect(firstName("  ")).toBe("");
    expect(resolveVariables([{ kind: "contact_name" }], "")).toEqual(["cliente"]);
    expect(firstName("McDonald")).toBe("McDonald");
  });
});

describe("021 — qué hacer con cada error de Meta", () => {
  const meta = (code: number, kind: SendError["code"] = "meta_error") =>
    new SendError(kind, `(#${code}) algo`, code);

  it("límite de ritmo → pausa y reintenta", () => {
    expect(classify(meta(130429)).kind).toBe("rate_limit");
    expect(classify(meta(80007)).kind).toBe("rate_limit");
  });
  it("número sin WhatsApp → falla SOLO ese destinatario, con motivo legible", () => {
    const d = classify(meta(131026));
    expect(d).toEqual({ kind: "recipient", message: expect.stringMatching(/no tiene WhatsApp/) });
  });
  it("token vencido, plantilla rota o número frenado por calidad → detiene la campaña", () => {
    expect(classify(new SendError("reconnect_required", "x")).kind).toBe("stop");
    expect(classify(new TemplateError("reconnect_required", "x")).kind).toBe("stop");
    expect(classify(new TemplateError("invalid", "Solo se pueden enviar plantillas aprobadas")).kind).toBe("stop");
    expect(classify(meta(132000)).kind).toBe("stop");
    expect(classify(meta(131048)).kind).toBe("stop");
  });
  it("Meta caído → reintento; error desconocido → falla ese destinatario", () => {
    expect(classify(new SendError("meta_unavailable", "x", 2)).kind).toBe("unavailable");
    expect(classify(new Error("boom")).kind).toBe("recipient");
  });
});

describe("021 — bandera CAMPAIGNS", () => {
  it("apagada por defecto", () => {
    expect(parseCampaignsFlag(undefined)).toBe(false);
    expect(parseCampaignsFlag("")).toBe(false);
    expect(parseCampaignsFlag("off")).toBe(false);
    expect(parseCampaignsFlag("on")).toBe(true);
    expect(parseCampaignsFlag(" TRUE ")).toBe(true);
  });
});
