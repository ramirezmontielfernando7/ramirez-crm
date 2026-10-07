import { asc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { apiError } from "@/lib/api";
import { requireBotKey } from "@/server/bot/auth";
import { serializeBotProfile } from "@/server/bot/profile";
import { generalKbCondition } from "@/server/agents/kb";
import { runWithOrganization } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/**
 * Perfil del agente + knowledge base para un cerebro externo.
 * GET /api/bot/profile → {profile, kb, resources}. Sin caché: cada consulta
 * refleja lo que el dueño dejó en la UI al momento (el TTL vive del lado del
 * bot, que es quien sabe cada cuánto le conviene releer).
 */
export async function GET(req: Request) {
  // H2: la llave dice la organización; nunca "la de la instancia".
  const auth = await requireBotKey(req);
  if (!auth.ok) return auth.response;
  const { organizationId } = auth;

  // PR 3: todo lo que sigue va a nombre de la organización de la llave.
  return runWithOrganization(organizationId, async () => {
    const db = getDb();
    const profiles = await db
      .select()
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, organizationId))
      .limit(1);
    const profile = profiles[0];
    if (!profile) {
      // Condición esperada (instancia sin perfil): el bot cae a su brief local.
      return apiError(404, "no_profile", "La instancia no tiene perfil de agente");
    }

    // 031: el del agente general (compartido + el suyo); el conocimiento
    // privado de otros agentes no viaja. Misma forma de siempre.
    const kb = await db
      .select()
      .from(schema.kbEntry)
      .where(scoped(schema.kbEntry.organizationId, organizationId, generalKbCondition(organizationId)))
      .orderBy(asc(schema.kbEntry.createdAt));

    return Response.json(serializeBotProfile(profile, kb));
  });
}
