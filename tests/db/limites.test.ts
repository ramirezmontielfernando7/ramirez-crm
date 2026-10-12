import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { recordUsage, reserveTurn } from "@/server/ai-quota/quota";
import { getKbDocLimits } from "@/server/kb-docs/limits";
import {
  assertCanAddMember,
  assertCanUpload,
  assertModulesWithinLimit,
  getEffectiveLimits,
  getEmbedTokenLimit,
  LimitError,
  saveOrgLimits,
} from "@/server/limits";
import { checkAiAlerts, listAlerts, markAlertsSeen, recordCrossings } from "@/server/limits/alerts";
import { runLimitsCheck } from "@/server/limits/daily";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 036 (PR 3a) — Límites, plan y avisos contra Postgres real (como
 * `vocero_app`, con RLS): los topes se leen de su tabla de siempre, se
 * guardan juntos, bloquean solo lo que deben, y los avisos no se repiten.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

const TODO = {
  teamChat: true,
  knowledge: true,
  results: true,
  agent: true,
  lab: true,
  campaigns: false,
  agenda: false,
  trabajo: false,
  atribucion: false,
  instagram: false,
  messenger: false,
  customNav: false,
};

async function archivo(org: string, bytes: number) {
  await getSystemDb().insert(schema.mediaAsset).values({
    id: newId("mediaAsset"),
    organizationId: org,
    kind: "image",
    fileSize: bytes,
    storagePath: `${org}/${newId("mediaAsset")}`,
    fetchStatus: "available",
  });
}

async function codigo(fn: () => Promise<void>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof LimitError) return err.code;
    throw err;
  }
}

describe("límites y plan", () => {
  let A: Org;
  let B: Org;
  beforeAll(async () => {
    A = await crearOrganizacion("Topes A");
    B = await crearOrganizacion("Topes B");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });
  afterEach(() => {
    delete process.env.AI_DEFAULT_MONTHLY_TURNS;
    delete process.env.AI_DEFAULT_MONTHLY_EMBED_TOKENS;
    resetEnvCacheForTests();
  });

  it("sin nada propio: Personalizado, almacenamiento solo avisa, y cada tope dice de dónde sale", async () => {
    process.env.AI_DEFAULT_MONTHLY_TURNS = "500";
    resetEnvCacheForTests();
    const l = await as(A.id, () => getEffectiveLimits(A.id));
    expect(l.planKey).toBe("custom");
    expect(l.storageMode).toBe("warn");
    expect(l.aiTurns).toEqual({ value: 500, source: "env" });
    expect(l.members).toEqual({ value: null, source: "none" });
    expect(l.kbMaxDocuments.source).toBe("env");
  });

  it("guarda los topes en su tabla de siempre (ai_quota, kb_document_limit, organization_plan) y null vuelve a heredar", async () => {
    const { before, after } = await saveOrgLimits(
      A.id,
      { aiTokens: 1000, members: 3, storageBytes: 5000, storageMode: "block_uploads", modules: 6, embedTokens: 777, kbMaxDocuments: 9 },
      null
    );
    expect(before.aiTokens.source).not.toBe("org");
    expect(after).toMatchObject({
      aiTokens: { value: 1000, source: "org" },
      members: { value: 3, source: "org" },
      storageBytes: { value: 5000, source: "org" },
      storageMode: "block_uploads",
      modules: { value: 6, source: "org" },
      embedTokens: { value: 777, source: "org" },
      kbMaxDocuments: { value: 9, source: "org" },
    });
    const [q] = await getSystemDb().select().from(schema.aiQuota).where(eq(schema.aiQuota.organizationId, A.id));
    expect(q?.monthlyTokenLimit).toBe(1000);
    expect((await as(A.id, () => getKbDocLimits(A.id))).maxDocuments).toBe(9);
    expect(await as(A.id, () => getEmbedTokenLimit(A.id))).toBe(777);

    const { after: otra } = await saveOrgLimits(A.id, { kbMaxDocuments: null }, null);
    expect(otra.kbMaxDocuments.source).toBe("env");
    expect(otra.members.value).toBe(3); // lo que no se mandó, no se tocó
  });

  it("almacenamiento en bloqueo: rechaza la subida que PASARÍA el tope", async () => {
    await archivo(A.id, 4000);
    expect(await as(A.id, () => codigo(() => assertCanUpload(A.id, 1000)))).toBeNull(); // 5000 = tope: cabe
    expect(await as(A.id, () => codigo(() => assertCanUpload(A.id, 1001)))).toBe("storage_limit");
  });

  it("en «Solo avisar» nunca bloquea, aunque se pase", async () => {
    await saveOrgLimits(A.id, { storageMode: "warn" }, null);
    expect(await as(A.id, () => codigo(() => assertCanUpload(A.id, 10_000_000)))).toBeNull();
    await saveOrgLimits(A.id, { storageMode: "block_uploads" }, null);
  });

  it("personas: al llegar al tope ya no se agrega otra", async () => {
    const n = (await getSystemDb().select().from(schema.member).where(eq(schema.member.organizationId, A.id))).length;
    await saveOrgLimits(A.id, { members: n + 1 }, null);
    expect(await as(A.id, () => codigo(() => assertCanAddMember(A.id)))).toBeNull();
    await saveOrgLimits(A.id, { members: n }, null);
    expect(await as(A.id, () => codigo(() => assertCanAddMember(A.id)))).toBe("member_limit");
  });

  it("módulos: encender de más se rechaza; apagar siempre se puede", async () => {
    await saveOrgLimits(A.id, { modules: 5 }, null);
    const cinco = TODO; // 5 encendidos
    expect(await as(A.id, () => codigo(() => assertModulesWithinLimit(A.id, cinco, { ...cinco, campaigns: true })))).toBe(
      "module_limit"
    );
    const siete = { ...TODO, campaigns: true, agenda: true };
    expect(await as(A.id, () => codigo(() => assertModulesWithinLimit(A.id, siete, { ...siete, agenda: false })))).toBeNull();
  });

  it("RLS: con A en el contexto no se ve ni se escribe el plan de B", async () => {
    await saveOrgLimits(B.id, { members: 99 }, null);
    const deA = await as(A.id, () => getDb().select().from(schema.organizationPlan));
    expect(deA.every((r) => r.organizationId === A.id)).toBe(true);
    await expect(
      as(A.id, () => getDb().insert(schema.usageAlert).values({ organizationId: B.id, period: "2026-10-01", metric: "storage", threshold: 80, used: 1, limitValue: 1 }))
    ).rejects.toThrow();
  });
});

describe("avisos de consumo", () => {
  let C: Org;
  beforeAll(async () => {
    C = await crearOrganizacion("Avisos C");
  });
  afterAll(async () => {
    await borrarOrganizaciones([C.id]);
  });

  it("80 % y luego 100 %, uno por umbral y mes (revisar dos veces no repite)", async () => {
    expect(await as(C.id, () => recordCrossings(C.id, "members", 8, 10))).toEqual([80]);
    expect(await as(C.id, () => recordCrossings(C.id, "members", 9, 10))).toEqual([]);
    expect(await as(C.id, () => recordCrossings(C.id, "members", 10, 10))).toEqual([100]);
    const lista = await as(C.id, () => listAlerts(C.id, { onlyUnseen: true }));
    expect(lista.map((a) => [a.metric, a.threshold])).toEqual([["members", 100]]); // solo el más alto
  });

  it("IA: al cruzar el tope de tokens del mes queda el aviso", async () => {
    await saveOrgLimits(C.id, { aiTokens: 1000 }, null);
    await as(C.id, async () => {
      await reserveTurn(C.id, "agent");
      await recordUsage(C.id, "agent", { promptTokens: 850, completionTokens: 0 });
      await checkAiAlerts(C.id);
    });
    const lista = await as(C.id, () => listAlerts(C.id));
    expect(lista.find((a) => a.metric === "ai_tokens")).toMatchObject({ threshold: 80, used: 850, limit: 1000 });
  });

  it("el Propietario los marca como vistos y dejan de salir", async () => {
    const userId = newId("user");
    await getSystemDb().insert(schema.user).values({ id: userId, name: "Dueña C", email: `${userId}@avisos.test` });
    const vistos = await as(C.id, () => markAlertsSeen(C.id, userId));
    expect(vistos).toBeGreaterThan(0);
    expect(await as(C.id, () => listAlerts(C.id, { onlyUnseen: true }))).toEqual([]);
    expect((await as(C.id, () => listAlerts(C.id))).every((a) => a.seenAt !== null)).toBe(true);
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("la revisión periódica avisa el almacenamiento que creció solo (multimedia entrante)", async () => {
    const D = await crearOrganizacion("Avisos D");
    try {
      await saveOrgLimits(D.id, { storageBytes: 1000 }, null);
      await archivo(D.id, 950);
      expect(await runLimitsCheck()).toBeGreaterThan(0);
      const lista = await as(D.id, () => listAlerts(D.id));
      expect(lista).toEqual([expect.objectContaining({ metric: "storage", threshold: 80, used: 950, limit: 1000 })]);
    } finally {
      await borrarOrganizaciones([D.id]);
    }
  });
});
