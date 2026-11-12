import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { chatJsonForOrg } from "@/server/ai-quota/llm";
import { orgUsdLimit } from "@/server/ai-quota/choice";
import { aiBlockedDetail, campaignsBlockedReason, forgetBilling, getBillingState } from "@/server/billing/store";
import { changeTrial, getOrgBilling, recordPayment } from "@/server/platform-admin/billing";
import { forgetPlatformControls, isKilled, setKillSwitch, getActiveBroadcast, startBroadcast, endBroadcast } from "@/server/platform-controls/store";
import { changePlanModules, clearPlanCatalogCache, getPlanProfiles } from "@/server/plan-catalog/store";
import { getEffectiveLimits, saveOrgLimits, syncPlanKey } from "@/server/limits";
import { FACTORY_PLAN_PROFILES } from "@/lib/platform-modules";
import { listHealthSignals } from "@/server/platform-admin/health";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 048 — Plataforma para vender, contra Postgres real: prueba gratis, pagos y
 * extras con su efecto, el freno de la IA y de las campañas, los
 * interruptores de emergencia, el aviso a todos y los módulos editables de
 * cada plan. Con RLS: la fila de cobro de una empresa no la ve otra.
 */

const DAY = 86_400_000;

describe("048 — cobro a mano, prueba gratis y controles de plataforma", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;
  beforeAll(async () => {
    A = await crearOrganizacion("Vender A");
    B = await crearOrganizacion("Vender B");
  });
  afterAll(async () => {
    await getSystemDb().delete(schema.platformKillSwitch);
    await getSystemDb().delete(schema.platformBroadcast);
    await getSystemDb().update(schema.platformPlanCatalog).set({ modules: null });
    clearPlanCatalogCache();
    forgetPlatformControls();
    await borrarOrganizaciones([A.id, B.id]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_TOKEN;
    delete process.env.OPENROUTER_MODEL;
    resetEnvCacheForTests();
    forgetBilling();
    forgetPlatformControls();
  });

  it("sin fila: opera como siempre", async () => {
    expect((await getBillingState(A.id)).kind).toBe("none");
    expect(await aiBlockedDetail(A.id)).toBeNull();
    expect(await campaignsBlockedReason(A.id)).toBeNull();
  });

  it("prueba vencida frena la IA (sin llamar al proveedor) y las campañas; la otra empresa sigue", async () => {
    await changeTrial(A.id, { endsAt: new Date(Date.now() - 1000) }, null, null);
    expect((await getBillingState(A.id)).kind).toBe("trial_expired");
    process.env.OPENROUTER_API_TOKEN = "sk-test";
    process.env.OPENROUTER_MODEL = "modelo/test";
    resetEnvCacheForTests();
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    const esquema = z.object({ ok: z.boolean() });
    const r = await runWithOrganization(A.id, () => chatJsonForOrg(A.id, "agent", esquema, [{ role: "user", content: "hola" }]));
    expect(r).toMatchObject({ ok: false, error: "quota_exceeded" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await campaignsBlockedReason(A.id)).toBe("la prueba gratis terminó");
    const rb = await runWithOrganization(B.id, () => chatJsonForOrg(B.id, "agent", esquema, [{ role: "user", content: "hola" }]));
    expect(rb.ok).toBe(true);
  });

  it("registrar la mensualidad levanta la restricción y alarga «pagado hasta»", async () => {
    const billing = await recordPayment(A.id, { kind: "plan", amountMxn: 999, months: 2 }, null, null);
    expect(billing.state.kind).toBe("paid");
    expect(billing.state.restricted).toBe(false);
    const until = Date.parse(billing.paidUntil!);
    expect(until - Date.now()).toBeGreaterThan(55 * DAY);
    expect(billing.payments).toHaveLength(1);
    expect(await aiBlockedDetail(A.id)).toBeNull();
  });

  it("persona extra y 50 GB suben los topes; sin tope se rechaza", async () => {
    await saveOrgLimits(A.id, { members: 3, storageBytes: 1024 ** 3 }, null);
    await recordPayment(A.id, { kind: "extra_person", amountMxn: 149, quantity: 2 }, null, null);
    await recordPayment(A.id, { kind: "extra_storage", amountMxn: 99 }, null, null);
    const limits = await runWithOrganization(A.id, () => getEffectiveLimits(A.id));
    expect(limits.members.value).toBe(5);
    expect(limits.storageBytes.value).toBe(51 * 1024 ** 3);
    await saveOrgLimits(B.id, { members: null }, null);
    await expect(recordPayment(B.id, { kind: "extra_person", amountMxn: 149 }, null, null)).rejects.toMatchObject({ status: 422 });
  });

  it("restablecer la IA suma otra bolsa solo este mes", async () => {
    await getSystemDb()
      .insert(schema.aiQuota)
      .values({ organizationId: A.id, monthlyUsdLimit: "2.0000" })
      .onConflictDoUpdate({ target: schema.aiQuota.organizationId, set: { monthlyUsdLimit: "2.0000" } });
    const antes = await runWithOrganization(A.id, () => orgUsdLimit(A.id));
    expect(antes).toBe(2);
    const b = await recordPayment(A.id, { kind: "ai_reset", amountMxn: 299 }, null, null);
    expect(b.aiBonusUsd).toBe(2);
    expect(await runWithOrganization(A.id, () => orgUsdLimit(A.id))).toBe(4);
  });

  it("RLS: la fila de cobro y los pagos de A no se ven desde B", async () => {
    const filas = await runWithOrganization(B.id, () => getDb().select().from(schema.organizationPayment));
    expect(filas.every((f) => f.organizationId === B.id)).toBe(true);
    const propias = await runWithOrganization(A.id, () => getDb().select().from(schema.organizationPayment).where(eq(schema.organizationPayment.organizationId, A.id)));
    expect(propias.length).toBeGreaterThan(0);
  });

  it("interruptor de emergencia de la IA frena a todas; al quitarlo, siguen", async () => {
    await setKillSwitch("ai", true, "prueba", null, null);
    expect(await isKilled("ai")).toBe(true);
    expect(await aiBlockedDetail(B.id)).toMatch(/mantenimiento/);
    await setKillSwitch("ai", false, null, null, null);
    expect(await aiBlockedDetail(B.id)).toBeNull();
  });

  it("interruptor de campañas frena el envío de todas", async () => {
    await setKillSwitch("campaigns", true, null, null, null);
    expect(await campaignsBlockedReason(B.id)).toMatch(/mantenimiento/);
    await setKillSwitch("campaigns", false, null, null, null);
    expect(await campaignsBlockedReason(B.id)).toBeNull();
  });

  it("aviso a todos: uno vigente a la vez y se quita", async () => {
    await startBroadcast({ message: "Primero", level: "info", endsAt: null }, null, null);
    await startBroadcast({ message: "Mantenimiento el domingo", level: "warning", endsAt: new Date(Date.now() + DAY) }, null, null);
    const bc = await getActiveBroadcast();
    expect(bc).toMatchObject({ message: "Mantenimiento el domingo", level: "warning" });
    const vivos = await getSystemDb().select().from(schema.platformBroadcast);
    expect(vivos.filter((v) => v.endedAt === null)).toHaveLength(1);
    await endBroadcast(null, null);
    expect(await getActiveBroadcast()).toBeNull();
  });

  it("módulos editables del plan: cambian la plantilla y el reflejo del plan guardado", async () => {
    const pro = { ...FACTORY_PLAN_PROFILES.pro, campaigns: true };
    await changePlanModules("pro", pro, null, null);
    const profiles = await getPlanProfiles();
    expect(profiles.pro.campaigns).toBe(true);
    // Unos interruptores iguales al Pro editado se reconocen como Pro.
    expect(await syncPlanKey(B.id, pro)).toBe("pro");
    // Y los de fábrica ya no son Pro.
    expect(await syncPlanKey(B.id, FACTORY_PLAN_PROFILES.pro)).toBe("custom");
    await changePlanModules("pro", null, null, null);
    expect((await getPlanProfiles()).pro.campaigns).toBe(FACTORY_PLAN_PROFILES.pro.campaigns);
  });

  it("prueba de 2 días: avisa que termina, sin frenar", async () => {
    await changeTrial(B.id, { days: 2 }, null, null);
    const dto = await getOrgBilling(B.id);
    expect(dto.state).toMatchObject({ kind: "trial_ending", restricted: false, daysLeft: 2 });
    expect(await aiBlockedDetail(B.id)).toBeNull();
    await changeTrial(B.id, { endsAt: null }, null, null);
    expect((await getBillingState(B.id)).kind).toBe("none");
  });

  it("semáforo: las señales se leen agrupadas para varias empresas sin fallar", async () => {
    const m = await listHealthSignals([A.id, B.id]);
    expect(m.size).toBe(2);
    expect(m.get(A.id)).toMatchObject({ sent7d: 0, failed7d: 0 });
    expect(typeof m.get(B.id)?.agentOn).toBe("boolean");
  });
});
