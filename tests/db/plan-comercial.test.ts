import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getSystemDb, schema, withTenant } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import { getEffectiveLimits, syncPlanKey } from "@/server/limits";
import { forgetOrgModules } from "@/server/modules";
import { listOrgsUsage } from "@/server/platform-admin/usage";
import { listPlatformAudit } from "@/server/platform-admin/audit";
import {
  changeOrganizationLimits,
  changeOrganizationModules,
  createOrganization,
} from "@/server/platform-admin/organizations";
import { planToggles } from "@/lib/platform-modules";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 040 — El plan comercial GUARDADO (`organization_plan.plan_key`) contra
 * Postgres real: nace con el plan del alta, sigue a los 13 interruptores
 * (exactos = esencial / pro / ultra; a la medida = custom), se sincroniza al
 * guardar topes, lo ven «Uso y plan» y /platform, el CHECK rechaza lo demás y
 * cada organización solo ve el suyo (RLS).
 */

const RUN = Math.random().toString(36).slice(2, 8);
const ACTOR = { userId: `usr_admin_plan_${RUN}`, email: `admin-${RUN}@plan.test` };
const creadas: string[] = [];
let altas = 0;

// `updated_by` apunta a un usuario de verdad.
beforeAll(async () => {
  await getSystemDb().insert(schema.user).values({ id: ACTOR.userId, name: "Admin plan", email: ACTOR.email });
});
afterAll(async () => {
  await borrarOrganizaciones(creadas);
  await getSystemDb().delete(schema.user).where(eq(schema.user.id, ACTOR.userId));
});
beforeEach(() => forgetOrgModules());

async function planGuardado(organizationId: string): Promise<string | null> {
  const [row] = await getSystemDb()
    .select({ planKey: schema.organizationPlan.planKey })
    .from(schema.organizationPlan)
    .where(eq(schema.organizationPlan.organizationId, organizationId));
  return row?.planKey ?? null;
}

async function alta(profile: "esencial" | "pro" | "ultra" | "personalizado"): Promise<string> {
  const r = await createOrganization(
    { name: `Plan ${profile} ${RUN}`, ownerName: "Dueña", ownerEmail: `plan-${profile}-${RUN}-${++altas}@plan.test`, profile },
    ACTOR,
    null
  );
  creadas.push(r.organizationId);
  return r.organizationId;
}

describe("040 — plan comercial guardado", () => {
  it("nace con el plan del alta (esencial, pro, ultra)", async () => {
    for (const p of ["esencial", "pro", "ultra"] as const) {
      const id = await alta(p);
      expect(await planGuardado(id)).toBe(p);
      const limits = await runWithOrganization(id, () => getEffectiveLimits(id));
      expect(limits.planKey).toBe(p);
    }
  });

  it("mover un interruptor a mano lo deja en «Personalizado»; volver a la plantilla, en su plan (y queda en la bitácora)", async () => {
    const id = await alta("pro");
    await changeOrganizationModules(id, { campaigns: true }, ACTOR, null);
    expect(await planGuardado(id)).toBe("custom");
    const [ultimo] = await listPlatformAudit({ organizationId: id });
    expect(ultimo?.detail).toMatchObject({ plan: { de: "pro", a: "custom" } });

    // La plantilla Ultra de un golpe (los 13), como el botón del detalle.
    await changeOrganizationModules(id, planToggles("ultra"), ACTOR, null);
    expect(await planGuardado(id)).toBe("ultra");
    await changeOrganizationModules(id, planToggles("esencial"), ACTOR, null);
    expect(await planGuardado(id)).toBe("esencial");
  });

  it("«Personalizado» al crear: el plan que corresponda a los módulos del entorno", async () => {
    const id = await alta("personalizado");
    const guardado = await planGuardado(id);
    expect(["esencial", "pro", "ultra", "custom"]).toContain(guardado);
  });

  it("guardar topes también lo deja al día (una organización sin fila de plan)", async () => {
    const O = await crearOrganizacion("PlanTopes");
    creadas.push(O.id);
    // Sin fila: se lee «Personalizado».
    expect(await planGuardado(O.id)).toBeNull();
    expect((await runWithOrganization(O.id, () => getEffectiveLimits(O.id))).planKey).toBe("custom");
    // Sus módulos pasan a ser exactamente Pro por fuera (sin pasar por /platform).
    await getSystemDb()
      .insert(schema.organizationModule)
      .values({ organizationId: O.id, ...moduleRow(planToggles("pro")) })
      .onConflictDoUpdate({ target: schema.organizationModule.organizationId, set: moduleRow(planToggles("pro")) });
    forgetOrgModules(O.id);
    const after = await changeOrganizationLimits(O.id, { members: 7 }, ACTOR, null);
    expect(after.planKey).toBe("pro");
    expect(after.members).toEqual({ value: 7, source: "org" });
    expect(await planGuardado(O.id)).toBe("pro");
    // /platform lo ve en la fila.
    const usage = await listOrgsUsage([O.id]);
    expect(usage.get(O.id)?.plan.planKey).toBe("pro");
  });

  it("el CHECK solo acepta esencial, pro, ultra y custom", async () => {
    const O = await crearOrganizacion("PlanCheck");
    creadas.push(O.id);
    for (const k of ["esencial", "pro", "ultra", "custom"]) {
      await getSystemDb()
        .insert(schema.organizationPlan)
        .values({ organizationId: O.id, planKey: k })
        .onConflictDoUpdate({ target: schema.organizationPlan.organizationId, set: { planKey: k } });
    }
    await expect(
      getSystemDb().update(schema.organizationPlan).set({ planKey: "gold" }).where(eq(schema.organizationPlan.organizationId, O.id))
    ).rejects.toThrow();
  });

  it("RLS: syncPlanKey escribe a nombre de la organización; otra no ve su fila", async () => {
    const A = await crearOrganizacion("PlanA");
    const B = await crearOrganizacion("PlanB");
    creadas.push(A.id, B.id);
    expect(await syncPlanKey(A.id, planToggles("ultra"))).toBe("ultra");
    const desdeB = await withTenant(B.id, (tx) =>
      tx.select().from(schema.organizationPlan).where(eq(schema.organizationPlan.organizationId, A.id))
    );
    expect(desdeB).toEqual([]);
    expect((await runWithOrganization(B.id, () => getEffectiveLimits(B.id))).planKey).toBe("custom");
  });
});

/** Los 13 interruptores → columnas de `organization_module`. */
function moduleRow(t: ReturnType<typeof planToggles>) {
  return {
    teamChat: t.teamChat,
    knowledge: t.knowledge,
    results: t.results,
    agent: t.agent,
    lab: t.lab,
    campaigns: t.campaigns,
    agenda: t.agenda,
    trabajo: t.trabajo,
    atribucion: t.atribucion,
    customNav: t.customNav,
    asistente: t.asistente,
    channels: [...(t.instagram ? ["instagram"] : []), ...(t.messenger ? ["messenger"] : [])],
  };
}
