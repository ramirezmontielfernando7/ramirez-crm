import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { ensureGeneralAgent } from "@/server/agents/ensure";
import { recordAgentUsage, recordEmbedUsage, recordUsage, reserveTurn } from "@/server/ai-quota/quota";
import { saveOrgLimits } from "@/server/limits";
import { recordCrossings } from "@/server/limits/alerts";
import { forgetOrgModules } from "@/server/modules/store";
import { getOwnerUsage } from "@/server/usage/owner";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 036 (PR 6) — «Uso y plan» del Propietario contra Postgres real (como
 * `vocero_app`, con RLS): su consumo del mes contra sus topes, por función y
 * por agente, sus avisos, y nada de otra organización.
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
    await saveOrgLimits(A.id, { aiTokens: 1000, members: 4, modules: 6, embedTokens: 5000 }, null);
  });
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
    expect(u.ai.tokens).toBe(850); // 800 del agente + 50 de redacción; los 99 999 de B no
    expect(u.ai.turns).toBe(2);
    expect(u.limits.aiTokens).toEqual({ value: 1000, source: "org" });
    expect(u.limits.planKey).toBe("custom");
    expect(u.embedTokens).toBe(1234);
    expect(u.limits.embedTokens.value).toBe(5000);
    expect(u.limits.members.value).toBe(4);
    const miembros = await getSystemDb().select().from(schema.member).where(eq(schema.member.organizationId, A.id));
    expect(u.members).toBe(miembros.length);
    expect(u.modules.total).toBe(12);
    expect(u.limits.modules.value).toBe(6);
  });

  it("qué función y qué agente consumen más", async () => {
    const u = await as(A.id, () => getOwnerUsage(A.id));
    expect(u.ai.byKind.agent).toEqual({ turns: 1, tokens: 800 });
    expect(u.ai.byKind.writing).toEqual({ turns: 1, tokens: 50 });
    expect(u.ai.byKind.embed?.tokens).toBe(1234);
    expect(u.ai.byAgent).toEqual([expect.objectContaining({ agentId: agenteA, tokens: 800, turns: 1 })]);
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
    const u = await as(B.id, () => getOwnerUsage(B.id));
    expect(u.ai.tokens).toBe(99_999);
    expect(u.ai.byAgent).toEqual([]);
    expect(u.limits.aiTokens.source).not.toBe("org");
  });
});
