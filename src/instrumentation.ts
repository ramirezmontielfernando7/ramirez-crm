/**
 * Hook de arranque de Next. El trabajo real vive en instrumentation-node.ts
 * (import dinámico condicionado al runtime para que el bundler edge no
 * intente resolver dependencias de Node como `postgres`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const {
      checkMediaDir,
      cleanupOrphanRuns,
      resumeSendingCampaigns,
      warnIfWebhookUnsigned,
    } = await import("./instrumentation-node");
    const { syncEnvBotKey } = await import("@/server/bot/keys");
    warnIfWebhookUnsigned();
    // Fase 3: antes que nada que lea credenciales (rotación de la llave y
    // secretos de Zernio en claro → cifrados). Nunca tumba el arranque.
    const { credentialMaintenanceOnBoot } = await import("@/server/credentials/maintenance");
    await credentialMaintenanceOnBoot();
    // Fase 3, PR 3: cada organización sin fila de módulos recibe los del
    // entorno ANTES de reanudar campañas o atender nada.
    const { backfillOrgModules } = await import("@/server/modules/store");
    await backfillOrgModules();
    await checkMediaDir();
    await cleanupOrphanRuns();
    await resumeSendingCampaigns();
    // H2: la BOT_API_KEY de la variable queda ligada a PLATFORM_ORG_ID.
    await syncEnvBotKey();
    // Fase 3: eventos sin organización, 7 días (al arrancar y cada hora).
    const { startUnroutedPurge } = await import("@/server/webhooks/unrouted");
    await startUnroutedPurge();
    // Campañas v2: salud del número y plantillas de Meta, una vez al día por
    // organización (revisa cada hora; no frena el arranque).
    const { startDailyMetaSync } = await import("@/server/meta-sync/daily");
    startDailyMetaSync();
    // 035: documentos del agente que quedaron en cola o sin vectores (solo
    // con KB_DOCS; no frena el arranque).
    const { resumeKbIndexing } = await import("@/server/kb-docs/indexer");
    void resumeKbIndexing();
  }
}
