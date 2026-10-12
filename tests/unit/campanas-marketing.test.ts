import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { and } from "drizzle-orm";
import {
  DEFAULT_MARKETING_MIN_DAYS,
  EXCLUSION_LABEL,
  isMarketingCategory,
  marketingCutoff,
} from "@/lib/campaigns";
import { describeTimelineItem } from "@/lib/timeline";
import { audienceConditions, emptyExclusions, marketingRulesFor } from "@/server/campaigns/audience";
import { classifySendError } from "@/server/campaigns/outcome";
import { blockedTemplateReason } from "@/server/campaigns/template-guard";
import { MARKETING_OPT_OUT_CODE } from "@/server/inbox/marketing-opt-out";
import { TemplateError } from "@/server/whatsapp/templates";

/**
 * 038 (PR 6) — Reglas puras de las campañas de marketing: qué plantillas
 * cuentan, el corte de la frecuencia, la condición SQL del público, el motivo
 * de la pausa por plantilla bloqueada y la línea de tiempo del 131050. Lo que
 * pasa en la BD lo prueba `tests/db/campanas-marketing.test.ts`.
 */

const dialect = new PgDialect();
const NOW = new Date("2026-10-12T12:00:00Z");

describe("038 — campañas de marketing: reglas puras", () => {
  it("solo MARKETING es marketing (sin importar mayúsculas); utilidad y autenticación no", () => {
    expect(isMarketingCategory("MARKETING")).toBe(true);
    expect(isMarketingCategory("marketing")).toBe(true);
    expect(isMarketingCategory("UTILITY")).toBe(false);
    expect(isMarketingCategory("AUTHENTICATION")).toBe(false);
    expect(isMarketingCategory(null)).toBe(false);
  });

  it("tope por defecto: 7 días; 0 lo apaga", () => {
    expect(DEFAULT_MARKETING_MIN_DAYS).toBe(7);
    expect(marketingCutoff(7, NOW)?.toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(marketingCutoff(0, NOW)).toBeNull();
    expect(marketingCutoff(Number.NaN, NOW)).toBeNull();
  });

  it("reglas por plantilla: utilidad no lleva ninguna; marketing lleva corte y no se cuenta a sí misma", () => {
    expect(marketingRulesFor("UTILITY", { marketingMinDays: 7 })).toBeNull();
    expect(marketingRulesFor("MARKETING", { marketingMinDays: 7 }, { campaignId: "cmp_1", now: NOW })).toEqual({
      cutoff: new Date("2026-10-05T12:00:00Z"),
      campaignId: "cmp_1",
    });
    expect(marketingRulesFor("MARKETING", { marketingMinDays: 0 })).toEqual({ cutoff: null, campaignId: null });
  });

  it("el público de marketing exige sin baja 131050 y sin marketing reciente; sin reglas, igual que antes", () => {
    const plain = dialect.sqlToQuery(and(...audienceConditions({}))!);
    expect(plain.sql).not.toMatch(/wa_marketing_opt_out_at/);
    expect(plain.sql).not.toMatch(/campaign_recipient/);

    const rules = marketingRulesFor("MARKETING", { marketingMinDays: 7 }, { campaignId: "cmp_1", now: NOW });
    const q = dialect.sqlToQuery(and(...audienceConditions({}, rules))!);
    expect(q.sql).toMatch(/"contact"\."wa_marketing_opt_out_at" is null/);
    expect(q.sql).toMatch(/not exists \(select 1 from "campaign_recipient" cr/);
    expect(q.sql).toMatch(/lower\(t\.category\) = 'marketing'/);
    expect(q.sql).toMatch(/m\.status = 'failed'/);
    expect(q.params).toContain("2026-10-05T12:00:00.000Z");
    expect(q.params).toContain("cmp_1");
    // La regla dura de siempre sigue ahí.
    expect(q.params).toContain("opt_in");

    // Tope en 0: solo la baja 131050.
    const off = dialect.sqlToQuery(and(...audienceConditions({}, marketingRulesFor("MARKETING", { marketingMinDays: 0 })))!);
    expect(off.sql).toMatch(/wa_marketing_opt_out_at" is null/);
    expect(off.sql).not.toMatch(/campaign_recipient/);
  });

  it("los dos motivos nuevos tienen etiqueta y arrancan en cero", () => {
    expect(emptyExclusions()).toMatchObject({ marketingOptOut: 0, recentMarketing: 0 });
    for (const k of Object.keys(emptyExclusions())) {
      expect(EXCLUSION_LABEL[k as keyof typeof EXCLUSION_LABEL]).toBeTruthy();
    }
  });

  it("plantilla pausada al enviar: la campaña se pausa con el motivo concreto de Meta", () => {
    const d = classifySendError(
      new TemplateError(
        "invalid",
        "La plantilla no se puede enviar: Meta la pausó por calidad (LOW_QUALITY). Solo se envían plantillas aprobadas y activas"
      )
    );
    expect(d.kind).toBe("pause");
    expect(d.reason).toBe(
      "La plantilla dejó de estar activa en Meta: Meta la pausó por calidad (LOW_QUALITY). Reanuda la campaña cuando Meta la reactive."
    );
    // Sin detalle reconocible, el motivo de siempre.
    expect(classifySendError(new TemplateError("invalid", "Solo se pueden enviar plantillas aprobadas")).reason).toBe(
      "La plantilla dejó de estar aprobada o activa en Meta"
    );
    expect(blockedTemplateReason("promo", "Meta la desactivó")).toMatch(/^Se pausó: la plantilla «promo» ya no se puede enviar \(Meta la desactivó\)\./);
  });

  it("131050 es el código de la baja de marketing y se cuenta aparte de la salud del número", () => {
    expect(MARKETING_OPT_OUT_CODE).toBe(131050);
  });

  it("línea de tiempo: la marca de Meta y quién la quitó", () => {
    const base = { id: "e1", at: NOW.toISOString(), actor: null };
    const set = describeTimelineItem({ ...base, kind: "marketing_opt_out", detail: { action: "set", code: "131050" } });
    expect(set.title).toBe("WhatsApp: dejó de recibir promociones de este negocio");
    expect(set.body).toMatch(/131050/);
    const cleared = describeTimelineItem({
      ...base,
      kind: "marketing_opt_out",
      actor: { type: "user", id: "u1", name: "Dueña" },
      detail: { action: "cleared" },
    });
    expect(cleared.title).toMatch(/^Volvió a aceptar promociones/);
    expect(cleared.title).toMatch(/Dueña/);
  });
});
