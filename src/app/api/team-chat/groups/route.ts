import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { TEAM_GROUP_NAME_MAX } from "@/lib/team-chat";
import { createGroup, listGroups } from "@/server/team-chat/threads";
import { teamChatErrorResponse } from "@/server/team-chat/errors";

export const dynamic = "force-dynamic";

/** 025 — Todos los grupos, para administrarlos (mismo permiso que crearlos). */
export const GET = withAuth(
  async (session) => {
    try {
      return Response.json({ groups: await listGroups(session.organizationId) });
    } catch (err) {
      return teamChatErrorResponse(err, "listar grupos");
    }
  },
  { permission: "team_chat.create_groups" }
);

const schema = z.object({
  name: z.string().min(1).max(TEAM_GROUP_NAME_MAX * 2),
  memberIds: z.array(z.string().min(1).max(64)).max(500),
});

/**
 * 025 — Crear un grupo (desde Ajustes). Propietario, o Coordinador si la
 * organización le delegó `team_chat.create_groups`.
 */
export const POST = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    try {
      const group = await createGroup(session, body.data);
      return Response.json({ threadId: group.id }, { status: 201 });
    } catch (err) {
      return teamChatErrorResponse(err, "crear grupo");
    }
  },
  { permission: "team_chat.create_groups" }
);
