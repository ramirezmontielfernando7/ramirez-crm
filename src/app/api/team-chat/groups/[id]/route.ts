import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { TEAM_GROUP_NAME_MAX } from "@/lib/team-chat";
import { deleteGroup, updateGroup } from "@/server/team-chat/threads";
import { teamChatErrorResponse } from "@/server/team-chat/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z
  .object({
    name: z.string().min(1).max(TEAM_GROUP_NAME_MAX * 2).optional(),
    memberIds: z.array(z.string().min(1).max(64)).max(500).optional(),
  })
  .refine((v) => v.name !== undefined || v.memberIds !== undefined, "Nada que cambiar");

/** 025 — Renombrar un grupo o reemplazar sus participantes. Otro tenant = 404. */
export const PATCH = withAuth(
  async (session, req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    try {
      const result = await updateGroup(session, id, body.data);
      return Response.json({ memberIds: result.memberIds });
    } catch (err) {
      return teamChatErrorResponse(err, "editar grupo");
    }
  },
  { permission: "team_chat.create_groups" }
);

/** Borrar un grupo con sus mensajes y archivos. */
export const DELETE = withAuth(
  async (session, _req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    try {
      await deleteGroup(session, id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return teamChatErrorResponse(err, "borrar grupo");
    }
  },
  { permission: "team_chat.create_groups" }
);
