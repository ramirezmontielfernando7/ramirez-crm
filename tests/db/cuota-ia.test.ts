import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getSystemDb, schema } from "@/lib/db";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { chatJsonForOrg } from "@/server/ai-quota/llm";
import { getUsageSummary, recordUsage, reserveTurn } from "@/server/ai-quota/quota";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Fase 3, PR 1 — cuota mensual de IA por organización, contra Postgres real
 * (como `vocero_app`, con RLS): el tope se respeta aun con turnos a la vez, el
 * consumo de una organización no toca el de otra, y al agotarse NO se llama al
 * proveedor.
 */

async function ponerTope(org: string, turns: number | null, tokens: number | null) {
  await getSystemDb()
    .insert(schema.aiQuota)
    .values({ organizationId: org, monthlyTurnLimit: turns, monthlyTokenLimit: tokens })
    .onConflictDoUpdate({
      target: [schema.aiQuota.organizationId],
      set: { monthlyTurnLimit: turns, monthlyTokenLimit: tokens },
    });
}

describe("cuota de IA por organización", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;
  beforeAll(async () => {
    A = await crearOrganizacion("Cuota A");
    B = await crearOrganizacion("Cuota B");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_TOKEN;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.AI_DEFAULT_MONTHLY_TURNS;
    resetEnvCacheForTests();
  });

  it("sin tope (ni propio ni default) todo pasa", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await runWithOrganization(B.id, () => reserveTurn(B.id, "agent"))).toEqual({ ok: true });
    }
    const resumen = await runWithOrganization(B.id, () => getUsageSummary(B.id));
    expect(resumen.turns).toBe(5);
    expect(resumen.limits).toEqual({ turns: null, tokens: null });
  });

  it("tope de turnos: 10 turnos a la vez con tope 3 → pasan exactamente 3", async () => {
    await ponerTope(A.id, 3, null);
    const r = await Promise.all(
      Array.from({ length: 10 }, () => runWithOrganization(A.id, () => reserveTurn(A.id, "agent")))
    );
    expect(r.filter((x) => x.ok)).toHaveLength(3);
    expect(r.find((x) => !x.ok)).toEqual({ ok: false, limit: "turns" });
    // El consumo de A no tocó a B.
    const b = await runWithOrganization(B.id, () => getUsageSummary(B.id));
    expect(b.turns).toBe(5);
  });

  it("tope de tokens: con los tokens gastados ya no entra otro turno", async () => {
    await ponerTope(B.id, null, 1000);
    await runWithOrganization(B.id, () => recordUsage(B.id, "agent", { promptTokens: 900, completionTokens: 150 }));
    expect(await runWithOrganization(B.id, () => reserveTurn(B.id, "writing"))).toEqual({ ok: false, limit: "tokens" });
    const resumen = await runWithOrganization(B.id, () => getUsageSummary(B.id));
    expect(resumen.tokens).toBe(1050);
    expect(resumen.byKind.agent?.tokens).toBe(1050);
  });

  it("el default del entorno aplica a quien no tiene tope propio", async () => {
    const C = await crearOrganizacion("Cuota C");
    try {
      process.env.AI_DEFAULT_MONTHLY_TURNS = "1";
      resetEnvCacheForTests();
      expect(await runWithOrganization(C.id, () => reserveTurn(C.id, "agent"))).toEqual({ ok: true });
      expect(await runWithOrganization(C.id, () => reserveTurn(C.id, "agent"))).toEqual({ ok: false, limit: "turns" });
    } finally {
      await borrarOrganizaciones([C.id]);
    }
  });

  it("chatJsonForOrg: suma los tokens del proveedor y, agotada la cuota, NO lo llama", async () => {
    const C = await crearOrganizacion("Cuota LLM");
    try {
      process.env.OPENROUTER_API_TOKEN = "sk-test";
      process.env.OPENROUTER_MODEL = "modelo/test";
      resetEnvCacheForTests();
      await ponerTope(C.id, 1, null);
      const fetchMock = vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 120, completion_tokens: 30 },
        })
      );
      vi.stubGlobal("fetch", fetchMock);
      const esquema = z.object({ ok: z.boolean() });
      const r1 = await runWithOrganization(C.id, () =>
        chatJsonForOrg(C.id, "agent", esquema, [{ role: "user", content: "hola" }])
      );
      expect(r1.ok).toBe(true);
      const r2 = await runWithOrganization(C.id, () =>
        chatJsonForOrg(C.id, "agent", esquema, [{ role: "user", content: "otra" }])
      );
      expect(r2).toMatchObject({ ok: false, error: "quota_exceeded" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const resumen = await runWithOrganization(C.id, () => getUsageSummary(C.id));
      expect(resumen).toMatchObject({ turns: 1, tokens: 150 });
    } finally {
      await borrarOrganizaciones([C.id]);
    }
  });
});
