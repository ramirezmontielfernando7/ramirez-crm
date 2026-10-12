import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { chatJsonForOrg } from "@/server/ai-quota/llm";
import { getUsageSummary, recordUsage, reserveTurn } from "@/server/ai-quota/quota";
import { acceptAssistantNotice, getAssistantStatus } from "@/server/assistant/status";
import { getEffectiveLimits, saveOrgLimits } from "@/server/limits";
import { checkAssistantAlerts, listAlerts } from "@/server/limits/alerts";
import { forgetOrgModules, getOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 038 (PR 1) — Base del asistente interno contra Postgres real (como
 * `vocero_app`, con RLS):
 *
 * - El módulo nace apagado en toda organización.
 * - Tope PROPIO del asistente: sin tope no se llama al modelo; al agotarse,
 *   se detiene y lo dice; sus turnos y tokens cuentan también en el total; el
 *   total agotado también lo detiene; los demás usos no se ven afectados por
 *   su tope.
 * - `chatJsonForOrg(org, "assistant", …)` rechaza ANTES de llamar al proveedor.
 * - Avisos 80/100 % del asistente, el estado que ve el Propietario y el aviso
 *   de consumo aceptado una vez.
 * - Visibilidad y tope se guardan; la BD rechaza valores fuera de rango.
 * - Las conversaciones del asistente no se ven desde otra organización.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

describe("038 — base del asistente interno", () => {
  let A: Org;
  let B: Org;
  let userId: string;

  beforeAll(async () => {
    A = await crearOrganizacion("Asistente A");
    B = await crearOrganizacion("Asistente B");
    userId = newId("user");
    await getSystemDb().insert(schema.user).values({ id: userId, name: "Dueña", email: `${userId}@x.test`, emailVerified: true });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, userId));
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_TOKEN;
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.AI_DEFAULT_MONTHLY_ASSISTANT_TOKENS;
    resetEnvCacheForTests();
  });

  const conIA = () => {
    process.env.OPENROUTER_API_TOKEN = "sk-prueba";
    // Nadie escucha aquí: si algo llegara a llamar al proveedor, fallaría distinto.
    process.env.OPENROUTER_BASE_URL = "http://127.0.0.1:9";
    resetEnvCacheForTests();
  };

  it("el módulo nace apagado (fila nueva y sin fila)", async () => {
    forgetOrgModules(A.id);
    expect((await getOrgModules(A.id)).asistente).toBe(false);
    const [row] = await getSystemDb()
      .select({ asistente: schema.organizationModule.asistente })
      .from(schema.organizationModule)
      .where(eq(schema.organizationModule.organizationId, A.id));
    expect(row?.asistente ?? false).toBe(false);
  });

  it("sin tope propio (ni del entorno) el asistente no se reserva y no gasta un turno del total", async () => {
    const antes = await as(A.id, () => getUsageSummary(A.id));
    expect(await as(A.id, () => reserveTurn(A.id, "assistant"))).toEqual({ ok: false, limit: "assistant_unset" });
    const despues = await as(A.id, () => getUsageSummary(A.id));
    expect(despues.turns).toBe(antes.turns);
    expect((await as(A.id, () => getEffectiveLimits(A.id))).assistantTokens).toEqual({ value: null, source: "none" });
    const st = await as(A.id, () => getAssistantStatus(A.id, userId));
    expect(st.state).toBe("not_configured"); // sin proveedor manda eso primero
    conIA();
    expect((await as(A.id, () => getAssistantStatus(A.id, userId))).state).toBe("unset");
  });

  it("el tope del entorno sirve de respaldo", async () => {
    process.env.AI_DEFAULT_MONTHLY_ASSISTANT_TOKENS = "5000";
    resetEnvCacheForTests();
    expect((await as(B.id, () => getEffectiveLimits(B.id))).assistantTokens).toEqual({ value: 5000, source: "env" });
    expect((await as(B.id, () => reserveTurn(B.id, "assistant"))).ok).toBe(true);
  });

  it("tope propio: cuenta también en el total, se agota y se detiene; los demás usos siguen", async () => {
    await saveOrgLimits(A.id, { assistantTokens: 100 }, null);
    expect((await as(A.id, () => getEffectiveLimits(A.id))).assistantTokens).toEqual({ value: 100, source: "org" });
    const antes = await as(A.id, () => getUsageSummary(A.id));
    expect(await as(A.id, () => reserveTurn(A.id, "assistant"))).toEqual({ ok: true });
    await as(A.id, () => recordUsage(A.id, "assistant", { promptTokens: 70, completionTokens: 15 }));
    const durante = await as(A.id, () => getUsageSummary(A.id));
    expect(durante.turns).toBe(antes.turns + 1);
    expect(durante.tokens).toBe(antes.tokens + 85);
    expect(durante.byKind.assistant).toEqual({ turns: 1, tokens: 85 });

    // 85 de 100: aviso del 80 %.
    await as(A.id, () => checkAssistantAlerts(A.id));
    const alertas = await as(A.id, () => listAlerts(A.id));
    expect(alertas).toEqual([expect.objectContaining({ metric: "assistant_tokens", threshold: 80, used: 85, limit: 100 })]);

    conIA();
    const disponible = await as(A.id, () => getAssistantStatus(A.id, userId));
    expect(disponible).toMatchObject({ state: "available", canAsk: true, gauge: { state: "near", percent: 85 } });

    await as(A.id, () => recordUsage(A.id, "assistant", { promptTokens: 20, completionTokens: 0 }));
    expect(await as(A.id, () => reserveTurn(A.id, "assistant"))).toEqual({ ok: false, limit: "assistant_tokens" });
    // Otro uso de IA no choca con el tope del asistente.
    expect(await as(A.id, () => reserveTurn(A.id, "agent"))).toEqual({ ok: true });

    const agotado = await as(A.id, () => getAssistantStatus(A.id, userId));
    expect(agotado).toMatchObject({ state: "exhausted", canAsk: false });
    expect(agotado.message).toMatch(/agotó su crédito de este mes y se detuvo/);
    expect(JSON.stringify(agotado)).not.toMatch(/"(used|limit)"/); // visibilidad por defecto: porcentaje

    await as(A.id, () => checkAssistantAlerts(A.id));
    expect((await as(A.id, () => listAlerts(A.id))).find((a) => a.metric === "assistant_tokens")?.threshold).toBe(100);
  });

  it("chatJsonForOrg(…, \"assistant\") rechaza ANTES de llamar al proveedor", async () => {
    conIA();
    const r = await as(A.id, () =>
      chatJsonForOrg(A.id, "assistant", z.object({ ok: z.boolean() }), [{ role: "user", content: "hola" }])
    );
    expect(r).toEqual({ ok: false, error: "quota_exceeded", detail: "tope mensual del asistente interno alcanzado" });
  });

  it("el total de la organización agotado también detiene al asistente", async () => {
    await saveOrgLimits(B.id, { assistantTokens: 10_000, aiTokens: 50 }, null);
    await as(B.id, async () => {
      await reserveTurn(B.id, "agent");
      await recordUsage(B.id, "agent", { promptTokens: 60, completionTokens: 0 });
    });
    expect(await as(B.id, () => reserveTurn(B.id, "assistant"))).toEqual({ ok: false, limit: "tokens" });
    conIA();
    const st = await as(B.id, () => getAssistantStatus(B.id, userId));
    expect(st.state).toBe("ai_exhausted");
    expect(st.message).toMatch(/IA de tu organización llegó a su tope/);
  });

  it("el aviso de consumo se acepta una vez y se conserva la primera fecha", async () => {
    expect((await as(A.id, () => getAssistantStatus(A.id, userId))).noticeAcceptedAt).toBeNull();
    const primera = await as(A.id, () => acceptAssistantNotice(A.id, userId, new Date("2026-10-01T10:00:00Z")));
    expect(primera).toBe("2026-10-01T10:00:00.000Z");
    const otra = await as(A.id, () => acceptAssistantNotice(A.id, userId, new Date("2026-10-02T10:00:00Z")));
    expect(otra).toBe("2026-10-01T10:00:00.000Z");
    // Es de esta persona en esta organización: en B no cuenta.
    expect((await as(B.id, () => getAssistantStatus(B.id, userId))).noticeAcceptedAt).toBeNull();
  });

  it("visibilidad y tope se guardan; la BD rechaza valores fuera de rango", async () => {
    await saveOrgLimits(A.id, { usageVisibility: "status" }, null);
    const l = await as(A.id, () => getEffectiveLimits(A.id));
    expect(l.usageVisibility).toBe("status");
    expect(l.assistantTokens.value).toBe(100); // tocar la visibilidad no toca el tope
    const st = await as(A.id, () => getAssistantStatus(A.id, userId));
    expect(st.gauge).toEqual({ state: "exhausted", percent: null });
    await saveOrgLimits(A.id, { usageVisibility: "percent" }, null);
    await expect(
      as(A.id, () => getDb().update(schema.organizationPlan).set({ usageVisibility: "usd" as never }).where(eq(schema.organizationPlan.organizationId, A.id)))
    ).rejects.toThrow();
    await expect(
      as(A.id, () => getDb().update(schema.organizationPlan).set({ maxActiveModules: 14 }).where(eq(schema.organizationPlan.organizationId, A.id)))
    ).rejects.toThrow();
    await as(A.id, () => getDb().update(schema.organizationPlan).set({ maxActiveModules: 13 }).where(eq(schema.organizationPlan.organizationId, A.id)));
    await expect(
      as(A.id, () => getDb().update(schema.aiQuota).set({ assistantMonthlyTokenLimit: -1 }).where(eq(schema.aiQuota.organizationId, A.id)))
    ).rejects.toThrow();
  });

  it("RLS: las conversaciones del asistente de A no se ven ni se escriben a nombre de B", async () => {
    const threadId = newId("assistantThread");
    await as(A.id, async () => {
      await getDb().insert(schema.assistantThread).values({ id: threadId, organizationId: A.id, userId, title: "Uso" });
      await getDb()
        .insert(schema.assistantMessage)
        .values({ id: newId("assistantMessage"), organizationId: A.id, threadId, role: "user", content: "¿Cuánto me queda?" });
    });
    const enB = await as(B.id, () => getDb().select().from(schema.assistantThread).where(eq(schema.assistantThread.id, threadId)));
    expect(enB).toEqual([]);
    const msjB = await as(B.id, () => getDb().select().from(schema.assistantMessage).where(eq(schema.assistantMessage.threadId, threadId)));
    expect(msjB).toEqual([]);
    await expect(
      as(B.id, () =>
        getDb()
          .insert(schema.assistantMessage)
          .values({ id: newId("assistantMessage"), organizationId: A.id, threadId, role: "assistant", content: "x" })
      )
    ).rejects.toThrow();
    const enA = await as(A.id, () =>
      getDb()
        .select()
        .from(schema.assistantMessage)
        .where(and(eq(schema.assistantMessage.organizationId, A.id), eq(schema.assistantMessage.threadId, threadId)))
    );
    expect(enA).toHaveLength(1);
  });
});
