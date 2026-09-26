import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getTeamChatSettings, updateTeamChatSettings } from "@/server/team-chat/settings";
import { teamChatErrorResponse } from "@/server/team-chat/errors";
import { publishToOrg } from "@/server/team-chat/audience";

export const dynamic = "force-dynamic";

/** 025 — Ajustes del chat de equipo. Solo el Propietario (`team_chat.oversee`). */
export const GET = withAuth(
  async (session) => {
    try {
      return Response.json({ settings: await getTeamChatSettings(session.organizationId) });
    } catch (err) {
      return teamChatErrorResponse(err, "leer ajustes");
    }
  },
  { permission: "team_chat.oversee" }
);

const schema = z
  .object({
    ownerOversight: z.boolean().optional(),
    showOversightNotice: z.boolean().optional(),
    coordinatorsCanCreateGroups: z.boolean().optional(),
  })
  .strict();

export const PUT = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    try {
      const settings = await updateTeamChatSettings(session.organizationId, body.data);
      // Cambia qué ve cada quien (supervisión, aviso, quién crea grupos): todos refetchean.
      await publishToOrg(session.organizationId, {
        type: "team.thread",
        data: { threadId: null, change: "settings" },
      });
      return Response.json({ settings });
    } catch (err) {
      return teamChatErrorResponse(err, "guardar ajustes");
    }
  },
  { permission: "team_chat.oversee" }
);
