import { apiError, parseBody, withAuth } from "@/lib/api";
import { deleteQuickReply, updateQuickReply } from "@/server/quick-replies/store";
import { quickReplySchema } from "@/lib/quick-replies";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const PATCH = withAuth(
  async (session, req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    const body = await parseBody(req, quickReplySchema.partial());
    if (!body.ok) return body.response;
    const res = await updateQuickReply(session.organizationId, id, body.data);
    if (res === null) return apiError(404, "not_found", "Respuesta no encontrada");
    if (res === "duplicate") return apiError(409, "duplicate", `Ya hay una respuesta con el atajo /${body.data.shortcut}`);
    return Response.json({ reply: res });
  },
  { permission: "templates.manage" }
);

export const DELETE = withAuth(
  async (session, _req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    if (!(await deleteQuickReply(session.organizationId, id))) return apiError(404, "not_found", "Respuesta no encontrada");
    return new Response(null, { status: 204 });
  },
  { permission: "templates.manage" }
);
