import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { ensureGeneralAgent } from "@/server/agents/ensure";
import { recordAgentUsage, recordEmbedUsage, recordUsage, reserveTurn } from "@/server/ai-quota/quota";
import { getManyOrgModules } from "@/server/modules";
import { getOrgUsageDetail, listOrgsUsage, organizationExists } from "@/server/platform-admin/usage";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 036 (PR 4) — El consumo que ve /platform, contra Postgres real: el resumen
 * de todas (pool de sistema, lecturas agrupadas) y el detalle de una (a
 * nombre de ella, RLS), con nombres de agentes, topes del entorno, sin mezclar
 * organizaciones y sin escribir nada al leer.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

/** Un turno contado como lo hace chatJsonForOrg (reserva + tokens + agente). */
async function turno(org: string, kind: "agent" | "lab" | "judge" | "writing", tokens: number, agentId?: string) {
  await as(org, async () => {
    await reserveTurn(org, kind);
    await recordUsage(org, kind, { promptTokens: tokens, completionTokens: 0 });
    if (agentId && kind !== "writing") await recordAgentUsage(org, agentId, kind, { promptTokens: tokens, completionTokens: 0 });
  });
}

describe("consumo por organización en /platform", () => {
  let A: Org;
  let B: Org;
  let generalA: string;
  let ventasA: string;
  let generalB: string;

  beforeAll(async () => {
    A = await crearOrganizacion("Consumo A");
    B = await crearOrganizacion("Consumo B");
    generalA = (await as(A.id, () => ensureGeneralAgent(A.id)))!.agent.id;
    generalB = (await as(B.id, () => ensureGeneralAgent(B.id)))!.agent.id;
    // Un segundo agente de A, que luego se archiva: su consumo sigue contando.
    ventasA = newId("agent");
    await getSystemDb()
      .insert(schema.agent)
      .values({ id: ventasA, organizationId: A.id, internalName: "Ventas", draft: {}, archivedAt: new Date() });

    await turno(A.id, "agent", 1000, generalA);
    await turno(A.id, "agent", 500, ventasA);
    await turno(A.id, "lab", 200, generalA);
    await turno(A.id, "judge", 100, generalA);
    await turno(A.id, "writing", 50);
    await as(A.id, () => recordEmbedUsage(A.id, 9999));
    await turno(B.id, "agent", 7, generalB);

    await getSystemDb().insert(schema.aiQuota).values({ organizationId: A.id, monthlyTurnLimit: 100, monthlyTokenLimit: null });
    await getSystemDb().insert(schema.mediaAsset).values({
      id: newId("mediaAsset"),
      organizationId: A.id,
      kind: "image",
      fileSize: 2048,
      storagePath: `${A.id}/x`,
      fetchStatus: "available",
    });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });
  afterEach(() => {
    delete process.env.AI_DEFAULT_MONTHLY_TOKENS;
    resetEnvCacheForTests();
  });

  it("resumen de todas: IA del mes contra su tope y almacenamiento, sin mezclar", async () => {
    const r = await listOrgsUsage([A.id, B.id]);
    expect(r.get(A.id)).toMatchObject({
      ai: { turns: 5, tokens: 1850, limits: { turns: 100, tokens: null } },
      storageBytes: 2048,
    });
    expect(r.get(B.id)).toMatchObject({ ai: { turns: 1, tokens: 7, limits: { turns: null, tokens: null } }, storageBytes: 0 });
  });

  it("sin tope propio (o NULL) vale el del entorno, igual que la cuota", async () => {
    process.env.AI_DEFAULT_MONTHLY_TOKENS = "123456";
    resetEnvCacheForTests();
    const r = await listOrgsUsage([A.id, B.id]);
    expect(r.get(A.id)?.ai.limits).toEqual({ turns: 100, tokens: 123456 });
    expect(r.get(B.id)?.ai.limits).toEqual({ turns: null, tokens: 123456 });
  });

  it("una organización sin consumo sale en ceros", async () => {
    const C = await crearOrganizacion("Consumo C");
    try {
      expect((await listOrgsUsage([C.id])).get(C.id)).toMatchObject({ ai: { turns: 0, tokens: 0 }, storageBytes: 0 });
    } finally {
      await borrarOrganizaciones([C.id]);
    }
  });

  it("detalle: por función (embeddings aparte) y por agente con su nombre, de mayor a menor", async () => {
    const d = await getOrgUsageDetail(A.id);
    expect(d.ai).toMatchObject({ turns: 5, tokens: 1850, limits: { turns: 100, tokens: null } });
    expect(d.ai.byKind).toEqual({
      agent: { turns: 2, tokens: 1500 },
      lab: { turns: 1, tokens: 200 },
      judge: { turns: 1, tokens: 100 },
      writing: { turns: 1, tokens: 50 },
      embed: { turns: 1, tokens: 9999 },
    });
    expect(d.ai.byAgent.map((a) => [a.name, a.archived, a.tokens, a.turns])).toEqual([
      ["Agente principal", false, 1300, 3],
      ["Ventas", true, 500, 1],
    ]);
    expect(d.ai.byAgent[0]!.byKind).toEqual({
      agent: { turns: 1, tokens: 1000 },
      lab: { turns: 1, tokens: 200 },
      judge: { turns: 1, tokens: 100 },
    });
    expect(d.storage.byCategory.whatsapp).toBe(2048);
  });

  it("el detalle de A no trae nada de B", async () => {
    const d = await getOrgUsageDetail(A.id);
    expect(d.ai.byAgent.some((a) => a.agentId === generalB)).toBe(false);
    const dB = await getOrgUsageDetail(B.id);
    expect(dB.ai.byAgent.map((a) => a.agentId)).toEqual([generalB]);
    expect(dB.storage.totalBytes).toBe(0);
  });

  it("leer no escribe: una organización sin agente general sigue sin él", async () => {
    const D = await crearOrganizacion("Consumo D");
    try {
      await getOrgUsageDetail(D.id);
      const agentes = await getSystemDb().select().from(schema.agent).where(eq(schema.agent.organizationId, D.id));
      expect(agentes).toHaveLength(0);
    } finally {
      await borrarOrganizaciones([D.id]);
    }
  });

  it("organizationExists y los módulos en bloque", async () => {
    expect(await organizationExists(A.id)).toBe(true);
    expect(await organizationExists("org_no_existe")).toBe(false);
    const m = await getManyOrgModules([A.id, B.id, "org_no_existe"]);
    expect([...m.keys()]).toEqual([A.id, B.id, "org_no_existe"]);
    expect(typeof m.get(A.id)?.campaigns).toBe("boolean");
  });
});
