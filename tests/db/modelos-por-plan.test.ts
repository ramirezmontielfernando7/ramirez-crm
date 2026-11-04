import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { recordUsage, reserveTurn } from "@/server/ai-quota/quota";
import { resolveAiChoice } from "@/server/ai-quota/choice";
import { estimateCallUsd } from "@/server/ai-quota/llm";
import { saveOrgAiOverrides } from "@/server/ai-settings/org";
import { changeOrgAi, getAiSettingsOverview, getOrgAiView } from "@/server/ai-settings/admin";
import { clearAiSettingsCache, saveModelPrice, savePlatformAiDefaults } from "@/server/ai-settings/platform";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 0070 — Modelo, esfuerzo y tope en dólares por instancia, plan y empresa,
 * contra Postgres real (la empresa con RLS; lo de plataforma, pool de sistema).
 */
describe("modelos por plan y empresa", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  beforeAll(async () => {
    A = await crearOrganizacion("Modelos A");
    process.env.OPENROUTER_MODEL = "env-agentes";
    resetEnvCacheForTests();
  });
  afterAll(async () => {
    await getSystemDb().delete(schema.platformAiDefaults);
    await getSystemDb().delete(schema.platformAiModelPrice);
    await getSystemDb().delete(schema.organizationPlan).where(eq(schema.organizationPlan.organizationId, A.id));
    clearAiSettingsCache();
    await borrarOrganizaciones([A.id]);
    delete process.env.OPENROUTER_MODEL;
    resetEnvCacheForTests();
  });
  afterEach(() => clearAiSettingsCache());

  it("sin nada guardado: el entorno, como siempre", async () => {
    const r = await runWithOrganization(A.id, () => resolveAiChoice(A.id, "agent"));
    expect(r).toEqual({ model: "env-agentes", effort: "low", usdLimit: null });
  });

  it("instancia < plan < empresa", async () => {
    await savePlatformAiDefaults("instance", { agentModel: "inst", agentEffort: "medium" }, null);
    expect((await runWithOrganization(A.id, () => resolveAiChoice(A.id, "agent"))).model).toBe("inst");

    await getSystemDb()
      .insert(schema.organizationPlan)
      .values({ organizationId: A.id, planKey: "pro" })
      .onConflictDoUpdate({ target: schema.organizationPlan.organizationId, set: { planKey: "pro" } });
    await savePlatformAiDefaults("pro", { agentModel: "plan-pro", monthlyUsdLimit: 5 }, null);
    let r = await runWithOrganization(A.id, () => resolveAiChoice(A.id, "agent"));
    expect(r).toEqual({ model: "plan-pro", effort: "medium", usdLimit: 5 });

    await saveOrgAiOverrides(A.id, { agentModel: "propio", agentEffort: "none", monthlyUsdLimit: 2 });
    r = await runWithOrganization(A.id, () => resolveAiChoice(A.id, "agent"));
    expect(r).toEqual({ model: "propio", effort: "none", usdLimit: 2 });

    // Volver a heredar: null borra lo propio.
    await saveOrgAiOverrides(A.id, { agentModel: null, agentEffort: null, monthlyUsdLimit: null });
    r = await runWithOrganization(A.id, () => resolveAiChoice(A.id, "agent"));
    expect(r).toEqual({ model: "plan-pro", effort: "medium", usdLimit: 5 });
  });

  it("costo estimado: precio capturado gana al conocido; sin precio, 0", async () => {
    const usage = { promptTokens: 1_000_000, completionTokens: 1_000_000 };
    expect(await estimateCallUsd("global.anthropic.claude-haiku-5-5", usage)).toBeCloseTo(0.6, 6);
    await saveModelPrice("global.anthropic.claude-haiku-5-5", { inputUsdPerMtok: 1, outputUsdPerMtok: 2 }, null);
    expect(await estimateCallUsd("global.anthropic.claude-haiku-5-5", usage)).toBeCloseTo(3, 6);
    expect(await estimateCallUsd("modelo-desconocido", usage)).toBe(0);
  });

  it("tope en dólares: al llegar, no deja más turnos", async () => {
    const now = new Date();
    await runWithOrganization(A.id, async () => {
      expect(await reserveTurn(A.id, "agent", now, 0, 1)).toEqual({ ok: true });
      await recordUsage(A.id, "agent", { promptTokens: 10, completionTokens: 10 }, now, 0, 0.6);
      expect(await reserveTurn(A.id, "agent", now, 0, 1)).toEqual({ ok: true });
      await recordUsage(A.id, "agent", { promptTokens: 10, completionTokens: 10 }, now, 0, 0.6);
      expect(await reserveTurn(A.id, "agent", now, 0, 1)).toEqual({ ok: false, limit: "usd" });
      // Sin tope en dólares, sigue.
      expect((await reserveTurn(A.id, "agent", now, 0, null)).ok).toBe(true);
    });
  });

  it("Plataforma: la vista de la empresa dice de dónde viene cada valor y el cambio queda en la bitácora", async () => {
    const actor = { userId: "usr_x", email: "admin@x.test" };
    let v = await changeOrgAi(A.id, { creatorModel: "terra-propio", monthlyUsdLimit: 3 }, actor, null);
    expect(v.effective.creator).toMatchObject({ model: "terra-propio", origin: "empresa" });
    expect(v.effective.agent).toMatchObject({ model: "plan-pro", origin: "plan" });
    expect(v.effective.monthlyUsdLimit).toBe(3);
    expect(v.inherited.monthlyUsdLimit).toBe(5);
    expect(v.spentThisMonth).toBeCloseTo(1.2, 6);
    const log = await getSystemDb().select().from(schema.platformAuditLog).where(eq(schema.platformAuditLog.targetOrgId, A.id));
    expect(log.some((l) => l.action === "organization.ai_changed")).toBe(true);
    await getSystemDb().delete(schema.platformAuditLog).where(eq(schema.platformAuditLog.targetOrgId, A.id));
    v = await getOrgAiView(A.id);
    expect(v.overrides.creatorModel).toBe("terra-propio");
    const o = await getAiSettingsOverview();
    expect(o.scopes.pro.effective.agent).toMatchObject({ model: "plan-pro", origin: "plan" });
    expect(o.catalog.find((m) => m.id === "global.openai.gpt-6-luna")?.price).toMatchObject({ source: "known" });
    expect(o.budget.spentThisMonth).toBeGreaterThan(0);
  });
});
