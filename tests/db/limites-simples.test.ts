import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import { fnSpentUsd, recordUsage, reserveTurn } from "@/server/ai-quota/quota";
import { getOrgAiState, saveOrgAiOverrides } from "@/server/ai-settings/org";
import { changeOrgAi } from "@/server/ai-settings/admin";
import { resolveAiChoice } from "@/server/ai-quota/choice";
import { getEffectiveLimits, saveOrgLimits } from "@/server/limits";
import { getOwnerUsage } from "@/server/usage/owner";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 0071 — Límites sencillos contra Postgres real: tope de seguridad por
 * función (agentes, creador, asistente) con «bloquear» o «solo avisar», la
 * bolsa en dólares en modo «solo avisar», el asistente usando la bolsa si no
 * tiene tope propio, «Porcentaje y dólares» para el cliente y el freno de
 * seguridad de documentos.
 */
type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

describe("0071 — límites sencillos", () => {
  let A: Org;
  beforeAll(async () => {
    A = await crearOrganizacion("Límites sencillos A");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
  });

  it("tope de la función en «bloquear»: frena esa función y solo esa", async () => {
    await as(A.id, () => saveOrgAiOverrides(A.id, { caps: { agent: { unit: "usd", value: 0.5, usd: 0.5 } }, agentMode: "block" }));
    const cap = { fn: "agent" as const, usdLimit: 0.5, mode: "block" as const };
    expect(await as(A.id, () => reserveTurn(A.id, "agent", new Date(), 0, null, cap))).toEqual({ ok: true });
    await as(A.id, () => recordUsage(A.id, "agent", { promptTokens: 10, completionTokens: 10 }, new Date(), 0, 0.6, "agent"));
    expect(await as(A.id, () => fnSpentUsd(A.id, "agent"))).toBeCloseTo(0.6);
    expect(await as(A.id, () => reserveTurn(A.id, "agent", new Date(), 0, null, cap))).toEqual({ ok: false, limit: "fn_usd" });
    // El creador no tiene tope propio: sigue.
    expect((await as(A.id, () => reserveTurn(A.id, "writing", new Date(), 0, null, { fn: "creator", usdLimit: null, mode: "block" }))).ok).toBe(true);
  });

  it("tope de la función en «solo avisar»: no frena", async () => {
    const cap = { fn: "agent" as const, usdLimit: 0.5, mode: "warn" as const };
    expect((await as(A.id, () => reserveTurn(A.id, "agent", new Date(), 0, null, cap))).ok).toBe(true);
  });

  it("la bolsa en dólares: bloquea o solo avisa según su modo", async () => {
    // Ya se gastaron 0.6 USD (arriba): una bolsa de 0.5 está llena.
    expect(await as(A.id, () => reserveTurn(A.id, "agent", new Date(), 0, 0.5, null, "block"))).toEqual({ ok: false, limit: "usd" });
    expect((await as(A.id, () => reserveTurn(A.id, "agent", new Date(), 0, 0.5, null, "warn"))).ok).toBe(true);
  });

  it("el asistente sin tope propio usa la bolsa; sin ningún tope no responde", async () => {
    // Sin bolsa ni tope propio: no responde (como siempre).
    const B = await crearOrganizacion("Límites sencillos B");
    try {
      expect(await as(B.id, () => reserveTurn(B.id, "assistant"))).toEqual({ ok: false, limit: "assistant_unset" });
      // Con bolsa en dólares: responde sin tope propio.
      expect((await as(B.id, () => reserveTurn(B.id, "assistant", new Date(), 0, 5))).ok).toBe(true);
    } finally {
      await borrarOrganizaciones([B.id]);
    }
  });

  it("los topes por función se guardan y la BD rechaza modos raros", async () => {
    const st = await as(A.id, () => getOrgAiState(A.id));
    expect(st.overrides.caps.agent.value).toBe(0.5);
    expect(st.overrides.caps.agent.unit).toBe("usd");
    expect(st.overrides.agentMode).toBe("block");
    await expect(
      getSystemDb().update(schema.aiQuota).set({ poolMode: "nunca" }).where(eq(schema.aiQuota.organizationId, A.id))
    ).rejects.toThrow();
  });

  it("0072 — reparto por función: % contra el total, suma que no pasa del total, % sin total se rechaza", async () => {
    const C = await crearOrganizacion("Límites reparto C");
    const actor = null;
    try {
      // % sin total: 422
      await expect(
        changeOrgAi(C.id, { caps: { agent: { unit: "pct", value: 20, usd: null } } } as never, actor, null)
      ).rejects.toMatchObject({ status: 422 });
      await as(C.id, () => saveOrgAiOverrides(C.id, { monthlyUsdLimit: 10 }));
      // 20 % de 10 USD = 2 USD
      await changeOrgAi(C.id, { caps: { agent: { unit: "pct", value: 20, usd: null } } } as never, actor, null);
      const st = await as(C.id, () => getOrgAiState(C.id));
      expect(st.overrides.caps.agent).toMatchObject({ unit: "pct", value: 20 });
      const ch = await as(C.id, () => resolveAiChoice(C.id, "agent"));
      expect(ch.fnCap?.usdLimit).toBeCloseTo(2);
      // 20 % + 9 USD pasa de 10 USD: 422
      await expect(
        changeOrgAi(C.id, { caps: { creator: { unit: "usd", value: 9, usd: 9 } } } as never, actor, null)
      ).rejects.toMatchObject({ status: 422 });
    } finally {
      await borrarOrganizaciones([C.id]);
    }
  });

  it("«Porcentaje y dólares»: el cliente ve gastado y tope; «tokens» ve su equivalencia; nunca dólares con las demás", async () => {
    await as(A.id, () => saveOrgAiOverrides(A.id, { monthlyUsdLimit: 2 }));
    await saveOrgLimits(A.id, { usageVisibility: "usd" }, null);
    const u = await as(A.id, () => getOwnerUsage(A.id));
    expect(u.visibility).toBe("usd");
    expect(u.ai.total.usd?.limit).toBe(2);
    expect(u.ai.total.tokens).toBeUndefined();
    await saveOrgLimits(A.id, { usageVisibility: "percent" }, null);
    const p = await as(A.id, () => getOwnerUsage(A.id));
    expect(p.ai.total.usd).toBeUndefined();
    expect(JSON.stringify(p.ai.total)).not.toContain("usd");
    await saveOrgLimits(A.id, { usageVisibility: "tokens" }, null);
    const t = await as(A.id, () => getOwnerUsage(A.id));
    expect(t.ai.total.usd).toBeUndefined();
    expect(t.ai.total.tokens?.used).toBeGreaterThanOrEqual(0);
  });

  it("documentos: freno de seguridad de 1 GB por defecto, editable, y sin tope de cantidad a la vista", async () => {
    const l = await as(A.id, () => getEffectiveLimits(A.id));
    expect(l.kbMaxTotalBytes.value).toBe(1024 ** 3);
    expect(l.kbMaxDocuments.value).toBeGreaterThanOrEqual(10_000);
    await saveOrgLimits(A.id, { kbMaxTotalBytes: 5 * 1024 ** 2 }, null);
    expect((await as(A.id, () => getEffectiveLimits(A.id))).kbMaxTotalBytes).toEqual({ value: 5 * 1024 ** 2, source: "org" });
  });
});
