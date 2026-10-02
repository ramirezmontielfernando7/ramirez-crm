import { and, eq, inArray, isNull } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { logger } from "@/lib/log";
import { utcDay } from "@/lib/phone-health";
import { runWithOrganization } from "@/lib/request-context";
import { refreshPhoneHealth } from "@/server/whatsapp/health";
import { syncTemplates } from "@/server/whatsapp/templates";

const log = logger("meta-diario");

/**
 * Campañas v2 (PR 1) — Sincronización diaria con Meta, dentro del proceso
 * (sin colas externas, Constitución II).
 *
 * Cada hora revisa qué organizaciones activas, con WhatsApp conectado, aún
 * no tienen la lectura de HOY de la salud de su número, y para cada una:
 * salud del número + plantillas. La lista sale del pool de sistema (cruza
 * organizaciones); el trabajo de cada una corre a nombre de ELLA
 * (`runWithOrganization`: cada consulta fija `app.org_id`), con la llamada a
 * Meta fuera de toda transacción.
 *
 * Dos contenedores a la vez (despliegue de Coolify) pueden leer lo mismo el
 * mismo minuto: el upsert por (organización, número, día) lo hace inocuo.
 * Una organización que falla no frena a las demás.
 */
export async function runDailyMetaSync(): Promise<{ orgs: number; failed: number }> {
  const today = utcDay();
  const pending = await getSystemDb()
    .select({ organizationId: schema.metaCredentials.organizationId })
    .from(schema.metaCredentials)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.metaCredentials.organizationId))
    .leftJoin(
      schema.waPhoneHealth,
      and(
        eq(schema.waPhoneHealth.organizationId, schema.metaCredentials.organizationId),
        eq(schema.waPhoneHealth.phoneNumberId, schema.metaCredentials.phoneNumberId),
        eq(schema.waPhoneHealth.day, today),
        inArray(schema.waPhoneHealth.source, ["sync", "manual"])
      )
    )
    .where(
      and(
        eq(schema.metaCredentials.status, "connected"),
        eq(schema.organization.status, "active"),
        isNull(schema.waPhoneHealth.id)
      )
    );

  let failed = 0;
  for (const { organizationId } of pending) {
    try {
      await runWithOrganization(organizationId, async () => {
        const health = await refreshPhoneHealth(organizationId, "sync");
        if (!health.ok) log.warn("salud del número sin leer", { org: organizationId, motivo: health.error });
        await syncTemplates(organizationId);
      });
    } catch (err) {
      failed++;
      log.error("la sincronización diaria de una organización falló", { org: organizationId, err });
    }
  }
  return { orgs: pending.length, failed };
}

const HOUR_MS = 60 * 60 * 1000;
const globalForSync = globalThis as unknown as { __voceroMetaDailySync?: NodeJS.Timeout };

/** Al arrancar: una pasada (sin frenar el arranque) y luego cada hora. */
export function startDailyMetaSync(): void {
  if (globalForSync.__voceroMetaDailySync) return;
  const run = async () => {
    try {
      const r = await runDailyMetaSync();
      if (r.orgs > 0) log.info(`sincronización diaria: ${r.orgs} organización(es), ${r.failed} con error`);
    } catch (err) {
      log.error("la sincronización diaria con Meta falló", { err });
    }
  };
  void run();
  globalForSync.__voceroMetaDailySync = setInterval(() => void run(), HOUR_MS);
  globalForSync.__voceroMetaDailySync.unref();
}
