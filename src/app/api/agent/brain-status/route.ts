import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv, isAiConfigured } from "@/lib/env";
import { hasActiveBotKey } from "@/server/bot/keys";
import { isPlatformOrg } from "@/server/platform";
import {
  botLastSeenAt,
  computeBrainStatus,
  getBrainHealth,
} from "@/server/bot/status";

export const dynamic = "force-dynamic";

/**
 * «Quién responde a tus clientes»: el agente incluido, el cerebro externo y
 * el aviso de doble respuesta. Ver `server/bot/status.ts`.
 */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const [rows, health, botKeyConfigured] = await Promise.all([
    db
      .select({ enabled: schema.agentProfile.enabled })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, session.organizationId))
      .limit(1),
    // El /health de Nea es de la plataforma: a otra organización no le dice
    // nada de su propio cerebro (ni debe verlo).
    isPlatformOrg(session.organizationId)
      ? getBrainHealth(getEnv().BRAIN_HEALTH_URL)
      : Promise.resolve(null),
    hasActiveBotKey(session.organizationId),
  ]);
  const status = computeBrainStatus({
    aiConfigured: isAiConfigured(),
    agentEnabled: rows[0]?.enabled ?? false,
    botKeyConfigured,
    lastSeenAt: botLastSeenAt(session.organizationId),
    health,
    now: new Date(),
  });
  return Response.json(status, { headers: { "cache-control": "no-store" } });
});
