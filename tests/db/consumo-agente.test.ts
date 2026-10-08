import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getDb, getSystemDb, getSystemSql, schema } from "@/lib/db";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { ensureGeneralAgent } from "@/server/agents/ensure";
import { chatJsonForOrg } from "@/server/ai-quota/llm";
import { currentPeriod, getAgentUsage, getUsageSummary, recordAgentUsage } from "@/server/ai-quota/quota";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 036 (PR 1) — Consumo de IA por agente (`ai_usage_agent`, migración 0042),
 * contra Postgres real como `vocero_app` (RLS): el turno se anota al agente
 * sin tocar la cuota, lo de A no se ve ni se escribe desde B, el agente de
 * otra organización no se acepta, y un fallo al anotar no tumba el turno.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);
const esquema = z.object({ ok: z.boolean() });

async function generalDe(org: string): Promise<string> {
  const g = await as(org, () => ensureGeneralAgent(org));
  return g!.agent.id;
}

function proveedorConTokens(prompt: number, completion: number) {
  const fetchMock = vi.fn(async () =>
    Response.json({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: prompt, completion_tokens: completion },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("consumo de IA por agente", () => {
  let A: Org;
  let B: Org;
  let agenteA: string;
  let agenteB: string;

  beforeAll(async () => {
    A = await crearOrganizacion("PorAgente A");
    B = await crearOrganizacion("PorAgente B");
    agenteA = await generalDe(A.id);
    agenteB = await generalDe(B.id);
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_TOKEN;
    delete process.env.OPENROUTER_MODEL;
    resetEnvCacheForTests();
  });

  it("chatJsonForOrg anota turno y tokens al agente; la cuota cuenta lo mismo que antes", async () => {
    process.env.OPENROUTER_API_TOKEN = "sk-test";
    process.env.OPENROUTER_MODEL = "modelo/test";
    resetEnvCacheForTests();
    proveedorConTokens(100, 20);

    await as(A.id, () => chatJsonForOrg(A.id, "agent", esquema, [{ role: "user", content: "hola" }], { agentId: agenteA }));
    await as(A.id, () => chatJsonForOrg(A.id, "lab", esquema, [{ role: "user", content: "prueba" }], { agentId: agenteA }));
    await as(A.id, () =>
      chatJsonForOrg(A.id, "judge", esquema, [{ role: "user", content: "juzga" }], { agentId: agenteA, judge: true })
    );
    // La escritura no tiene agente.
    await as(A.id, () => chatJsonForOrg(A.id, "writing", esquema, [{ role: "user", content: "redacta" }]));

    const porAgente = await as(A.id, () => getAgentUsage(A.id));
    expect(porAgente.sort((x, y) => x.kind.localeCompare(y.kind))).toEqual([
      { agentId: agenteA, kind: "agent", turns: 1, tokens: 120 },
      { agentId: agenteA, kind: "judge", turns: 1, tokens: 120 },
      { agentId: agenteA, kind: "lab", turns: 1, tokens: 120 },
    ]);
    // El total de la cuota NO se duplica: 4 turnos, 480 tokens.
    const resumen = await as(A.id, () => getUsageSummary(A.id));
    expect(resumen).toMatchObject({ turns: 4, tokens: 480 });
    expect(resumen.byKind.writing).toEqual({ turns: 1, tokens: 120 });
  });

  it("10 turnos a la vez del mismo agente suman 10 (sin perder ninguno)", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () =>
        as(B.id, () => recordAgentUsage(B.id, agenteB, "agent", { promptTokens: 5, completionTokens: 1 }))
      )
    );
    const filas = await as(B.id, () => getAgentUsage(B.id));
    expect(filas).toEqual([{ agentId: agenteB, kind: "agent", turns: 10, tokens: 60 }]);
  });

  it("el mes es el de la cuota (UTC): otro mes es otra fila", async () => {
    const otroMes = new Date("2020-01-15T12:00:00Z");
    await as(B.id, () => recordAgentUsage(B.id, agenteB, "lab", null, otroMes));
    expect(await as(B.id, () => getAgentUsage(B.id, otroMes))).toEqual([
      { agentId: agenteB, kind: "lab", turns: 1, tokens: 0 },
    ]);
    // El mes actual sigue intacto.
    expect((await as(B.id, () => getAgentUsage(B.id))).map((r) => r.kind)).toEqual(["agent"]);
  });

  it("RLS: con A en el contexto no se lee nada de B; sin organización, cero filas", async () => {
    expect(await as(A.id, () => getAgentUsage(B.id))).toEqual([]);
    const crudas = await as(A.id, () => getDb().select().from(schema.aiUsageAgent));
    expect(crudas.every((r) => r.organizationId === A.id)).toBe(true);
    expect(crudas.length).toBeGreaterThan(0);
    // Desde el pool de sistema (plataforma) sí se ven las dos.
    const [n] = await getSystemSql()<{ n: number }[]>`
      select count(distinct organization_id)::int as n from ai_usage_agent
      where organization_id in (${A.id}, ${B.id})`;
    expect(n!.n).toBe(2);
  });

  it("RLS: con A en el contexto no se escribe una fila de B", async () => {
    await expect(
      as(A.id, () =>
        getDb()
          .insert(schema.aiUsageAgent)
          .values({ organizationId: B.id, period: currentPeriod(), agentId: agenteB, kind: "agent", turns: 99 })
      )
    ).rejects.toThrow();
    const filas = await as(B.id, () => getAgentUsage(B.id));
    expect(filas.find((r) => r.kind === "agent")?.turns).toBe(10);
  });

  it("FK compuesta: el agente de B no se puede anotar en A", async () => {
    await expect(as(A.id, () => recordAgentUsage(A.id, agenteB, "agent", null))).rejects.toThrow();
    expect((await as(A.id, () => getAgentUsage(A.id))).some((r) => r.agentId === agenteB)).toBe(false);
  });

  it("si falla al anotar (agente inexistente), el turno sigue y la cuota sí lo cuenta", async () => {
    process.env.OPENROUTER_API_TOKEN = "sk-test";
    process.env.OPENROUTER_MODEL = "modelo/test";
    resetEnvCacheForTests();
    proveedorConTokens(7, 3);
    const antes = await as(B.id, () => getUsageSummary(B.id));
    const r = await as(B.id, () =>
      chatJsonForOrg(B.id, "agent", esquema, [{ role: "user", content: "hola" }], { agentId: "agt_no_existe" })
    );
    expect(r).toMatchObject({ ok: true, data: { ok: true } });
    const despues = await as(B.id, () => getUsageSummary(B.id));
    expect(despues.turns).toBe(antes.turns + 1);
    expect(despues.tokens).toBe(antes.tokens + 10);
  });

  it("borrar la organización borra su consumo por agente (cascada)", async () => {
    const C = await crearOrganizacion("PorAgente C");
    const agenteC = await generalDe(C.id);
    await as(C.id, () => recordAgentUsage(C.id, agenteC, "agent", { promptTokens: 1, completionTokens: 1 }));
    await borrarOrganizaciones([C.id]);
    const quedan = await getSystemDb().select().from(schema.aiUsageAgent);
    expect(quedan.some((r) => r.organizationId === C.id)).toBe(false);
  });
});
