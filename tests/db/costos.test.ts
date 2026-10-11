import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import { ensureGeneralAgent } from "@/server/agents/ensure";
import { currentPeriod, recordAgentUsage, recordEmbedUsage, recordUsage, reserveTurn } from "@/server/ai-quota/quota";
import { addPricing, listPricing } from "@/server/costs/pricing";
import { getCostReport } from "@/server/costs/report";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 036 (PR 3b) — Costos contra Postgres real: el costo que reporta el
 * proveedor se suma en `cost_usd` (total, función y agente), los precios
 * guardan historial y el panel estima, suma lo real y proyecta, sin mezclar
 * organizaciones.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);
const usd = (v: string | undefined) => Number(v ?? "NaN");

describe("costos de IA", () => {
  let A: Org;
  let B: Org;
  let C: Org;
  let agenteA: string;
  const precios: string[] = [];

  beforeAll(async () => {
    A = await crearOrganizacion("Costos A");
    B = await crearOrganizacion("Costos B");
    C = await crearOrganizacion("Costos C (sin consumo)");
    agenteA = (await as(A.id, () => ensureGeneralAgent(A.id)))!.agent.id;
  });
  afterAll(async () => {
    if (precios.length) await getSystemDb().delete(schema.platformAiPricing).where(inArray(schema.platformAiPricing.id, precios));
    await getSystemDb().delete(schema.platformAuditLog).where(eq(schema.platformAuditLog.action, "pricing.changed"));
    await borrarOrganizaciones([A.id, B.id, C.id]);
  });

  it("suma el costo real reportado al total, a la función y al agente", async () => {
    await as(A.id, async () => {
      for (const cost of [0.01, 0.02]) {
        await reserveTurn(A.id, "agent");
        await recordUsage(A.id, "agent", { promptTokens: 500_000, completionTokens: 100_000, costUsd: cost });
        await recordAgentUsage(A.id, agenteA, "agent", { promptTokens: 500_000, completionTokens: 100_000, costUsd: cost });
      }
      // Un turno sin costo reportado (otro proveedor): suma tokens, no costo.
      await reserveTurn(A.id, "writing");
      await recordUsage(A.id, "writing", { promptTokens: 1_000_000, completionTokens: 0 });
      await recordEmbedUsage(A.id, 2_000_000, new Date(), 0.004);
    });
    await as(B.id, async () => {
      await reserveTurn(B.id, "judge");
      await recordUsage(B.id, "judge", { promptTokens: 1_000_000, completionTokens: 0 });
    });

    const filas = await getSystemDb()
      .select()
      .from(schema.aiUsage)
      .where(eq(schema.aiUsage.organizationId, A.id));
    const de = (k: string) => filas.find((f) => f.kind === k && f.period === currentPeriod());
    expect(usd(de("total")?.costUsd)).toBeCloseTo(0.03, 6);
    expect(usd(de("agent")?.costUsd)).toBeCloseTo(0.03, 6);
    expect(usd(de("writing")?.costUsd)).toBe(0);
    expect(usd(de("embed")?.costUsd)).toBeCloseTo(0.004, 6);
    const [porAgente] = await getSystemDb().select().from(schema.aiUsageAgent).where(eq(schema.aiUsageAgent.agentId, agenteA));
    expect(usd(porAgente?.costUsd)).toBeCloseTo(0.03, 6);
  });

  it("los precios guardan historial; uno con «vigente desde» futuro no rige todavía", async () => {
    const base = await addPricing(
      {
        chatInputUsdPerMtok: 3,
        chatOutputUsdPerMtok: 15,
        judgeInputUsdPerMtok: 1,
        judgeOutputUsdPerMtok: null,
        embedUsdPerMtok: 0.02,
        usdToLocal: 18.5,
        localCurrency: "MXN",
        validFrom: "2000-01-01",
      },
      null,
      null
    );
    const futuro = await addPricing(
      {
        chatInputUsdPerMtok: 999,
        chatOutputUsdPerMtok: 999,
        judgeInputUsdPerMtok: null,
        judgeOutputUsdPerMtok: null,
        embedUsdPerMtok: 999,
        usdToLocal: 1,
        localCurrency: "USD",
        validFrom: "2999-01-01",
      },
      null,
      null
    );
    precios.push(base.id, futuro.id);
    const h = await listPricing();
    expect(h.map((p) => p.id)).toEqual(expect.arrayContaining([base.id, futuro.id]));
    expect(base.validFrom).toBe("2000-01-01T00:00:00.000Z");
    expect(base.judgeOutputUsdPerMtok).toBeNull();
  });

  it("el panel: estimado con el precio vigente, real reportado, proyección; sin consumo no ocupa renglón", async () => {
    const r = await getCostReport();
    // Otros archivos de prueba pueden tener precios: el vigente es el más
    // reciente no futuro. Este test solo exige que NO sea el futuro.
    expect(r.pricing?.chatInputUsdPerMtok).not.toBe(999);
    const p = r.pricing!;
    const a = r.rows.find((x) => x.organizationId === A.id)!;
    const b = r.rows.find((x) => x.organizationId === B.id)!;
    expect(r.rows.some((x) => x.organizationId === C.id)).toBe(false);

    const estA = (1_000_000 * p.chatInputUsdPerMtok + 200_000 * p.chatOutputUsdPerMtok + 1_000_000 * p.chatInputUsdPerMtok + 2_000_000 * p.embedUsdPerMtok) / 1e6;
    expect(a.estimatedUsd).toBeCloseTo(estA, 6);
    expect(a.realUsd).toBeCloseTo(0.034, 6);
    expect(a.byKind.map((k) => k.kind)).toEqual(["agent", "writing", "embed"]);
    expect(b.realUsd).toBeNull(); // el proveedor no reportó nada
    expect(b.estimatedUsd).toBeCloseTo(p.judgeInputUsdPerMtok ?? p.chatInputUsdPerMtok, 6);
    // La proyección parte del mayor entre estimado y real (aquí, el estimado).
    expect(a.projectedUsd!).toBeGreaterThanOrEqual(Math.max(a.estimatedUsd!, a.realUsd!));
    expect(b.projectedUsd!).toBeGreaterThanOrEqual(b.estimatedUsd!);
    expect(r.elapsed).toBeGreaterThan(0);
  });
});
