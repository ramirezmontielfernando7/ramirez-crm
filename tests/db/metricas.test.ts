import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getSystemDb as getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { MetaApiError } from "@/lib/meta/client";
import { runWithOrganization } from "@/lib/request-context";
import { getCampaignMetrics } from "@/server/campaigns/metrics";
import { syncMetaAnalytics } from "@/server/meta-sync/analytics";
import { runDailyAnalyticsSync } from "@/server/meta-sync/daily";
import { updateOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Campañas v2, PR 3 — Métricas contra Postgres real. Meta se simula
 * reemplazando `graphRequest` (la única salida hacia Meta).
 */
const graph = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/meta/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/meta/client")>()),
  graphRequest: graph.fn,
}));

const DAY = 86_400;
const hoy = () => Math.floor(Date.now() / 1000 / DAY) * DAY;

function respuestaMeta(path: string): unknown {
  const fields = decodeURIComponent(path.split("fields=")[1] ?? "");
  if (fields.includes("template_analytics")) {
    return {
      template_analytics: {
        data: [
          {
            data_points: [
              { template_id: "WT-1", start: hoy(), end: hoy() + DAY, sent: 10, delivered: 9, read: 6, clicked: [{ type: "quick_reply_button", count: 2 }] },
            ],
          },
        ],
      },
    };
  }
  return {
    currency: "MXN",
    pricing_analytics: {
      data: [{ data_points: [{ start: hoy(), end: hoy() + DAY, pricing_category: "MARKETING", pricing_type: "REGULAR", country: "MX", volume: 10, cost: 7.5 }] }],
    },
  };
}

describe("métricas de campañas", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;
  beforeAll(async () => {
    A = await crearOrganizacion("Metricas A");
    B = await crearOrganizacion("Metricas B");
    await getDb().insert(schema.template).values({
      id: newId("template"),
      organizationId: A.id,
      name: "promo_octubre",
      language: "es_MX",
      category: "marketing",
      body: "Hola {{1}}",
      status: "approved",
      waTemplateId: "WT-1",
    });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });
  beforeEach(() => {
    graph.fn.mockReset();
    graph.fn.mockImplementation(async (path: string) => respuestaMeta(path));
  });

  it("primera vez trae 90 días de plantillas y 1 año de precios; repetir no duplica", async () => {
    const r1 = await runWithOrganization(A.id, () => syncMetaAnalytics(A.id));
    expect(r1.map((r) => [r.kind, r.status])).toEqual([
      ["pricing", "ok"],
      ["template", "ok"],
    ]);
    const starts = graph.fn.mock.calls.map(([p]) => {
      const f = decodeURIComponent(String(p));
      return { kind: f.includes("template_analytics") ? "t" : "p", start: Number(/\.start\((\d+)\)/.exec(f)![1]) };
    });
    const minT = Math.min(...starts.filter((s) => s.kind === "t").map((s) => s.start));
    const minP = Math.min(...starts.filter((s) => s.kind === "p").map((s) => s.start));
    expect((hoy() - minT) / DAY).toBe(89);
    expect((hoy() - minP) / DAY).toBe(364);

    graph.fn.mockClear();
    await runWithOrganization(A.id, () => syncMetaAnalytics(A.id));
    // La diaria ya no repite la carga inicial: un tramo por analítica.
    expect(graph.fn).toHaveBeenCalledTimes(2);
    const t = await getDb().select().from(schema.waTemplateAnalyticsDaily).where(eq(schema.waTemplateAnalyticsDaily.organizationId, A.id));
    const p = await getDb().select().from(schema.waPricingAnalyticsDaily).where(eq(schema.waPricingAnalyticsDaily.organizationId, A.id));
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ sent: 10, delivered: 9, read: 6, clicked: 2 });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ volume: 10, cost: 7.5, currency: "MXN", pricingCategory: "MARKETING" });
  });

  it("analíticas de plantillas no activas: se anota y los precios siguen", async () => {
    graph.fn.mockImplementation(async (path: string) => {
      if (decodeURIComponent(path).includes("template_analytics")) {
        throw new MetaApiError("Template analytics is not enabled for this WABA (is_enabled_for_insights)", { status: 400, code: 100 });
      }
      return respuestaMeta(path);
    });
    const r = await runWithOrganization(A.id, () => syncMetaAnalytics(A.id));
    expect(r.find((x) => x.kind === "template")!.status).toBe("not_enabled");
    expect(r.find((x) => x.kind === "pricing")!.status).toBe("ok");
    const m = await runWithOrganization(A.id, () => getCampaignMetrics(A.id, {}));
    expect(m.sync.template.status).toBe("not_enabled");
    // Un fallo no borra la última sincronización buena.
    expect(m.sync.template.syncedAt).not.toBeNull();
    expect(m.sync.pricing.status).toBe("ok");
    expect(m.cost.reported).toBe(7.5);
  });

  it("KPIs: enviados, entregados, leídos, respuestas en 72 h, fallidos con motivo, bajas y costo", async () => {
    const db = getDb();
    const [tpl] = await db.select().from(schema.template).where(eq(schema.template.organizationId, A.id));
    const campaignId = newId("campaign");
    await db.insert(schema.campaign).values({
      id: campaignId,
      organizationId: A.id,
      templateId: tpl!.id,
      name: "Promo octubre",
      status: "completed",
      total: 5,
      estimatedCost: 5,
      costCurrency: "MXN",
      phoneNumberId: A.phoneNumberId,
      startedAt: new Date(Date.now() - 4 * 3_600_000),
    });
    const envio = new Date(Date.now() - 100 * 3_600_000); // hace 100 h
    type Caso = { status: "sent" | "failed"; m?: "delivered" | "read" | "failed" | "sent"; reply?: number; optOut?: boolean; code?: number };
    const casos: Caso[] = [
      { status: "sent", m: "read", reply: 2 }, // respondió a las 2 h
      { status: "sent", m: "delivered", reply: 80 }, // respondió tarde (80 h > 72 h)
      { status: "sent", m: "delivered", optOut: true },
      { status: "sent", m: "sent" },
      { status: "failed", code: 131049 },
    ];
    for (const [i, c] of casos.entries()) {
      const contactId = newId("contact");
      const conversationId = newId("conversation");
      await db.insert(schema.contact).values({
        id: contactId,
        organizationId: A.id,
        name: `Cliente ${i}`,
        waIdentity: `52155000${i}${Date.now() % 10000}`,
        waConsent: c.optOut ? "opt_out" : "opt_in",
        waConsentAt: c.optOut ? new Date(envio.getTime() + 3_600_000) : null,
      });
      await db.insert(schema.conversation).values({ id: conversationId, organizationId: A.id, contactId });
      let messageId: string | null = null;
      if (c.m) {
        messageId = newId("message");
        await db.insert(schema.message).values({
          id: messageId,
          organizationId: A.id,
          conversationId,
          direction: "out",
          origin: "template",
          status: c.m,
          createdAt: envio,
          sentAt: envio,
          deliveredAt: c.m === "delivered" || c.m === "read" ? envio : null,
          readAt: c.m === "read" ? envio : null,
        });
      }
      if (c.reply !== undefined) {
        await db.insert(schema.message).values({
          id: newId("message"),
          organizationId: A.id,
          conversationId,
          direction: "in",
          text: "¡Me interesa!",
          createdAt: new Date(envio.getTime() + c.reply * 3_600_000),
        });
      }
      await db.insert(schema.campaignRecipient).values({
        id: newId("campaignRecipient"),
        organizationId: A.id,
        campaignId,
        contactId,
        contactName: `Cliente ${i}`,
        status: c.status,
        messageId,
        sentAt: c.status === "sent" ? envio : null,
        createdAt: envio,
        errorCode: c.code ?? null,
        errorMessage: c.code ? "raw" : null,
      });
    }

    const m = await runWithOrganization(A.id, () => getCampaignMetrics(A.id, {}));
    expect(m.replyWindowHours).toBe(72);
    expect(m.totals).toEqual({ sent: 4, delivered: 3, read: 1, replied: 1, failed: 1, optOuts: 1 });
    expect(m.failureReasons).toHaveLength(1);
    expect(m.failureReasons[0]!.code).toBe(131049);
    expect(m.failureReasons[0]!.reason).toContain("131049");
    expect(m.campaigns).toHaveLength(1);
    // Estimado al lanzar (5 para 5) prorrateado a 4 enviados.
    expect(m.campaigns[0]!.estimatedCost).toBe(4);
    expect(m.cost.estimated).toBe(4);
    expect(m.cost.reported).toBe(7.5);
    expect(m.cost.difference).toBe(3.5);
    expect(m.series.reduce((s, d) => s + d.sent, 0)).toBe(4);
    expect(m.templates[0]).toMatchObject({ name: "promo_octubre", sent: 10 });

    // El filtro por número: otro número no ve la campaña.
    const otro = await runWithOrganization(A.id, () => getCampaignMetrics(A.id, { phoneNumberId: "PN-otro" }));
    expect(otro.totals.sent).toBe(0);
  });

  it("una organización no ve las métricas ni las analíticas de otra", async () => {
    const m = await runWithOrganization(B.id, () => getCampaignMetrics(B.id, {}));
    expect(m.totals.sent).toBe(0);
    expect(m.cost.reported).toBeNull();
    expect(m.templates).toEqual([]);
    expect(m.sync.template.status).toBe("never");
  });

  it("la diaria: solo organizaciones con Campañas, una vez al día", async () => {
    await updateOrgModules(B.id, { campaigns: true }, "prueba");
    graph.fn.mockClear();
    const r1 = await runDailyAnalyticsSync();
    // A ya intentó hoy; B entra por primera vez (además de las de otras pruebas).
    const llamadasB = graph.fn.mock.calls.filter(([p]) => String(p).startsWith(B.wabaId));
    expect(llamadasB.length).toBeGreaterThan(0);
    expect(graph.fn.mock.calls.some(([p]) => String(p).startsWith(A.wabaId))).toBe(false);
    expect(r1.orgs).toBeGreaterThanOrEqual(1);
    graph.fn.mockClear();
    await runDailyAnalyticsSync();
    expect(graph.fn.mock.calls.some(([p]) => String(p).startsWith(B.wabaId))).toBe(false);
  });
});
