import { and, eq, isNotNull, or } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";
import { checkMemberAlerts, checkModuleAlerts, checkStorageAlerts } from "./alerts";

/**
 * 036 (PR 3a) — Revisión periódica de los avisos que no crecen con una
 * acción del CRM: el almacenamiento sube solo con la multimedia ENTRANTE de
 * WhatsApp (que nunca se bloquea). Revisa también personas y módulos, por si
 * un cambio entró por fuera (un script del operador). Solo organizaciones
 * activas con algún tope de esos; cada una a nombre de la suya (RLS).
 */

const log = logger("limits");

/** Organizaciones activas con tope de almacenamiento, personas o módulos (pool de sistema: cruza organizaciones). */
async function orgsWithLimits(): Promise<string[]> {
  const rows = await getSystemDb()
    .select({ id: schema.organizationPlan.organizationId })
    .from(schema.organizationPlan)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.organizationPlan.organizationId))
    .where(
      and(
        eq(schema.organization.status, "active"),
        or(
          isNotNull(schema.organizationPlan.storageLimitBytes),
          isNotNull(schema.organizationPlan.maxMembers),
          isNotNull(schema.organizationPlan.maxActiveModules)
        )
      )
    );
  return rows.map((r) => r.id);
}

export async function runLimitsCheck(now = new Date()): Promise<number> {
  const orgs = await orgsWithLimits();
  for (const org of orgs) {
    await runWithOrganization(org, async () => {
      await checkStorageAlerts(org, now);
      await checkMemberAlerts(org, now);
      await checkModuleAlerts(org, now);
    });
  }
  return orgs.length;
}

const EVERY_MS = 6 * 60 * 60 * 1000;
const globalForLimits = globalThis as unknown as { __voceroLimitsCheck?: NodeJS.Timeout };

/** Al arrancar: una pasada (sin frenar el arranque) y luego cada 6 horas. */
export function startLimitsCheck(): void {
  if (globalForLimits.__voceroLimitsCheck) return;
  const run = async () => {
    try {
      const n = await runLimitsCheck();
      if (n > 0) log.info(`revisión de avisos de consumo: ${n} organización(es)`);
    } catch (err) {
      log.error("la revisión de avisos de consumo falló", { err });
    }
  };
  void run();
  globalForLimits.__voceroLimitsCheck = setInterval(() => void run(), EVERY_MS);
  globalForLimits.__voceroLimitsCheck.unref();
}
