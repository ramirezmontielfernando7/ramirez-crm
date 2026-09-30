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
    await checkMediaDir();
    await cleanupOrphanRuns();
    await resumeSendingCampaigns();
    // H2: la BOT_API_KEY de la variable queda ligada a PLATFORM_ORG_ID.
    await syncEnvBotKey();
  }
}
