import { asc, gt } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";
import { purgeOrgPushDevices } from "./devices";
import { mobilePushProvider } from "./fcm";

const log = logger("mobile-push");
let started = false;

async function purge() {
  let cursor = "";
  const org = schema.organization;
  const system = getSystemDb(); // Enumerates IDs only; the deletion uses RLS.
  for (;;) {
    const rows = await system.select({ id: org.id }).from(org).where(gt(org.id, cursor)).orderBy(asc(org.id)).limit(100);
    for (const row of rows) {
      cursor = row.id;
      await runWithOrganization(row.id, () => purgeOrgPushDevices(row.id));
    }
    if (rows.length < 100) return;
  }
}

export function startMobilePushPurge() {
  if (started || !mobilePushProvider()) return;
  started = true;
  let running = false;
  const run = () => {
    if (running || !mobilePushProvider()) return;
    running = true;
    void purge().catch(() => log.warn("No se pudo purgar registros móviles"))
      .finally(() => { running = false; });
  };
  run();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}
