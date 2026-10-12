import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { ensureGeneralAgent } from "@/server/agents/ensure";
import { recordAgentUsage, recordEmbedUsage, recordUsage, reserveTurn } from "@/server/ai-quota/quota";
import type { UsageVisibility } from "@/lib/limits";
import { saveOrgLimits } from "@/server/limits";
import { recordCrossings } from "@/server/limits/alerts";
import { forgetOrgModules } from "@/server/modules/store";
import { getOwnerUsage, listOwnerAlerts } from "@/server/usage/owner";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 036 (PR 6) — «Uso y plan» del Propietario contra Postgres real (como
 * `vocero_app`, con RLS): su consumo del mes contra sus topes, por función y
 * por agente, sus avisos, y nada de otra organización.
 *
 * 038 (PR 1): lo que ve de su IA depende de la visibilidad que fija la
 * plataforma (`tokens`, `percent` —por defecto— o `status`), recortado en el
 * servidor. Los casos de 036 corren con `tokens` (cifras reales).
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

describe("«Uso y plan» del Propietario", () => {
  let A: Org;
  let B: Org;
  let agenteA: string;

  beforeAll(async () => {
    A = await crearOrganizacion("Uso A");
    B = await crearOrganizacion("Uso B");
    agenteA = (await as(A.id, () => ensureGeneralAgent(A.id)))!.agent.id;
    await as(A.id, async () => {
      await reserveTurn(A.id, "agent");
      await recordUsage(A.id, "agent", { promptTokens: 700, completionTokens: 100 });
      await recordAgentUsage(A.id, agenteA, "agent", { promptTokens: 700, completionTokens: 100 });
      await reserveTurn(A.id, "writing");
      await recordUsage(A.id, "writing", { promptTokens: 50, completionTokens: 0 });
      await recordEmbedUsage(A.id, 1234);
    });
    await as(B.id, async () => {
      await reserveTurn(B.id, "agent");
      await recordUsage(B.id, "agent", { promptTokens: 99_999, completionTokens: 0 });
    });
    await saveOrgLimits(A.id, { aiTokens: 1000, members: 4, modules: 6, embedTokens: 5000, usageVisibility: "tokens" }, null);
  });

  const conVisibilidad = (v: UsageVisibility) => saveOrgLimits(A.id, { usageVisibility: v }, null);
  afterAll(async () => {
    delete process.env.KB_DOCS;
    resetEnvCacheForTests();
    await borrarOrganizaciones([A.id, B.id]);
  });
  afterEach(() => {
    delete process.env.KB_DOCS;
    resetEnvCacheForTests();
  });

  it("su consumo del mes contra sus topes, sin nada de otra organización", async () => {
    const u = await as(A.id, () => getOwnerUsage(A.id));
    expect(u.visibility).toBe("tokens");
    expect(u.ai.total.tokens).toEqual({ used: 850, limit: 1000 }); // 800 del agente + 50 de redacción; los 99 999 de B no
    expect(u.ai.total.turns).toEqual({ used: 2, limit: null });
    expect(u.ai.total.percent).toBe(85);
    expect(u.limits.planKey).toBe("custom");
    expect(u.ai.embed).toMatchObject({ used: 1234, limit: 5000 });
    expect(u.limits.members.value).toBe(4);
    const miembros = await getSystemDb().select().from(schema.member).where(eq(schema.member.organizationId, A.id));
    expect(u.members).toBe(miembros.length);
    expect(u.modules.total).toBe(13);
    expect(u.limits.modules.value).toBe(6);
    // Los topes de IA no viajan sueltos: van dentro de cada medidor.
    expect(Object.keys(u.limits)).not.toContain("aiTokens");
  });

  it("qué función y qué agente consumen más", async () => {
    const u = await as(A.id, () => getOwnerUsage(A.id));
    const kind = (k: string) => u.ai.byKind?.find((l) => l.key === k);
    expect(kind("agent")).toMatchObject({ turns: 1, tokens: 800 });
    expect(kind("writing")).toMatchObject({ turns: 1, tokens: 50 });
    expect(kind("embed")).toBeUndefined(); // los embeddings van en su propio medidor
    expect(u.ai.byAgent).toEqual([expect.objectContaining({ key: agenteA, tokens: 800, turns: 1 })]);
  });

  it("sus avisos del mes, con texto para el Propietario", async () => {
    await as(A.id, () => recordCrossings(A.id, "ai_tokens", 850, 1000));
    const u = await as(A.id, () => getOwnerUsage(A.id));
    expect(u.alerts).toEqual([expect.objectContaining({ metric: "ai_tokens", threshold: 80, text: expect.stringContaining("80 %") })]);
  });

  it("documentos: solo si la organización los usa (KB_DOCS + Laboratorio)", async () => {
    expect((await as(A.id, () => getOwnerUsage(A.id))).documents).toBeNull();
    process.env.KB_DOCS = "on";
    resetEnvCacheForTests();
    await getSystemDb()
      .insert(schema.organizationModule)
      .values({ organizationId: A.id, agenda: false, lab: true })
      .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { lab: true } });
    forgetOrgModules(A.id);
    expect((await as(A.id, () => getOwnerUsage(A.id))).documents).toEqual({ documents: 0, chunks: 0 });
  });

  it("RLS: a nombre de B no se ve el consumo de A", async () => {
    await saveOrgLimits(B.id, { usageVisibility: "tokens" }, null);
    const u = await as(B.id, () => getOwnerUsage(B.id));
    expect(u.ai.total.tokens?.used).toBe(99_999);
    expect(u.ai.byAgent).toEqual([]);
    expect(u.ai.total.tokens?.limit).not.toBe(1000);
    await saveOrgLimits(B.id, { usageVisibility: "percent" }, null);
  });

  it("038 — por defecto (`percent`): solo porcentajes, ni tokens ni turnos en el JSON", async () => {
    const nueva = await crearOrganizacion("Uso C");
    try {
      const c = await as(nueva.id, () => getOwnerUsage(nueva.id));
      expect(c.visibility).toBe("percent");
    } finally {
      await borrarOrganizaciones([nueva.id]);
    }
    await conVisibilidad("percent");
    try {
      const u = await as(A.id, () => getOwnerUsage(A.id));
      expect(u.ai.total).toEqual({ state: "near", percent: 85 });
      expect(u.ai.embed).toEqual({ state: "available", percent: 25 });
      const json = JSON.stringify(u.ai);
      expect(json).not.toMatch(/"(used|limit|tokens|turns)"/);
      expect(json).not.toContain("850");
      expect(json).not.toContain("1234");
      // El desglose es su parte del total, sin cifras.
      expect(u.ai.byKind?.find((l) => l.key === "agent")?.share).toBeCloseTo(800 / 850);
      expect(u.ai.byAgent?.[0]).toEqual(expect.objectContaining({ key: agenteA, share: 1 }));
      expect(u.ai.byAgent?.[0]).not.toHaveProperty("tokens");
      // Los avisos de IA, sin la palabra «tokens» y sin cifras.
      const avisos = await as(A.id, () => listOwnerAlerts(A.id));
      const ia = avisos.find((a) => a.metric === "ai_tokens");
      expect(ia?.text).toBe("Tu organización va en el 80 % de su IA del mes.");
      expect(ia).not.toHaveProperty("used");
    } finally {
      await conVisibilidad("tokens");
    }
  });

  it("038 — `status`: solo «Disponible» / «Agotado», sin números ni desglose", async () => {
    await conVisibilidad("status");
    try {
      const u = await as(A.id, () => getOwnerUsage(A.id));
      expect(u.ai.total).toEqual({ state: "available", percent: null }); // 85 %: aún «Disponible»
      expect(u.ai.byKind).toBeNull();
      expect(u.ai.byAgent).toBeNull();
      expect(JSON.stringify(u.ai)).not.toMatch(/\d{3,}/);
      const ia = (await as(A.id, () => listOwnerAlerts(A.id))).find((a) => a.metric === "ai_tokens");
      expect(ia?.text).toBe("A tu organización le queda poco de su IA del mes.");
      expect(ia?.text).not.toMatch(/\d/);
      await as(A.id, () => recordCrossings(A.id, "ai_tokens", 1000, 1000));
      const lleno = (await as(A.id, () => listOwnerAlerts(A.id))).find((a) => a.metric === "ai_tokens");
      expect(lleno?.text).toBe("Tu organización agotó su IA del mes.");
    } finally {
      await conVisibilidad("tokens");
    }
  });

  it("038 — el asistente interno: solo con el módulo, con su tope propio", async () => {
    expect((await as(A.id, () => getOwnerUsage(A.id))).ai.assistant).toBeNull();
    await getSystemDb()
      .insert(schema.organizationModule)
      .values({ organizationId: A.id, asistente: true })
      .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { asistente: true } });
    forgetOrgModules(A.id);
    try {
      await saveOrgLimits(A.id, { assistantTokens: 400 }, null);
      await as(A.id, async () => {
        await reserveTurn(A.id, "assistant");
        await recordUsage(A.id, "assistant", { promptTokens: 90, completionTokens: 10 });
      });
      const u = await as(A.id, () => getOwnerUsage(A.id));
      expect(u.ai.assistant).toEqual({ state: "available", percent: 25, used: 100, limit: 400 });
      expect(u.ai.byKind?.find((l) => l.key === "assistant")).toMatchObject({ tokens: 100, turns: 1 });
      await conVisibilidad("percent");
      expect((await as(A.id, () => getOwnerUsage(A.id))).ai.assistant).toEqual({ state: "available", percent: 25 });
    } finally {
      await conVisibilidad("tokens");
      await getSystemDb()
        .update(schema.organizationModule)
        .set({ asistente: false })
        .where(eq(schema.organizationModule.organizationId, A.id));
      forgetOrgModules(A.id);
    }
  });
});
