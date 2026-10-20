import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { withAgentErrors } from "@/server/agents/http";
import { setAgentPaused } from "@/server/agents/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const putSchema = z.object({ paused: z.boolean() });

/**
 * 042 — El interruptor de UN agente. Apagado, sus chats pasan a atención
 * humana (no se quedan en silencio); su configuración no se toca.
 */
export const PUT = withAuth(async (session, req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? (await moduleOff(session.organizationId, "agent"));
  if (off) return off;
  const { id } = await ctx.params;
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  return withAgentErrors(async () =>
    Response.json(await setAgentPaused(session.organizationId, id, session.userId, body.data.paused))
  );
}, { permission: "agent.manage" });
