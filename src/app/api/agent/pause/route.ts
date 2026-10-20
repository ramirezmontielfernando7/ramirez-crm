import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { withAgentErrors } from "@/server/agents/http";
import { getOrgPause, setOrgPaused } from "@/server/agents/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 042 — ¿Están en pausa todos los agentes de la organización? */
export const GET = withAuth(async (session) => {
  const off = await moduleOff(session.organizationId, "agent");
  if (off) return off;
  return Response.json(await getOrgPause(session.organizationId), { headers: { "cache-control": "no-store" } });
}, { permission: "agent.manage" });

const putSchema = z.object({ paused: z.boolean() });

/**
 * 042 — El interruptor GENERAL (freno de emergencia): pausa o reanuda a todos
 * los agentes sin tocar su configuración. Mientras dura, los chats pasan a
 * atención humana.
 */
export const PUT = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "agent");
  if (off) return off;
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  return withAgentErrors(async () =>
    Response.json(await setOrgPaused(session.organizationId, session.userId, body.data.paused))
  );
}, { permission: "agent.manage" });
