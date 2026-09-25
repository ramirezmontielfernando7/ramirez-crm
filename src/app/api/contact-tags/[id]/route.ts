import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { TAG_COLORS } from "@/lib/tags";
import { deleteTag, TAG_ERROR_STATUS, TagError, updateTag } from "@/server/tags/tags";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().max(200).optional(),
  color: z.enum(TAG_COLORS).nullable().optional(),
});

function tagErrorResponse(err: unknown): Response {
  if (err instanceof TagError) return apiError(TAG_ERROR_STATUS[err.code], err.code, err.message);
  throw err;
}

/** 021 — Renombrar o cambiar el color de una etiqueta. */
export const PATCH = withAuth(
  async (session, req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    const body = await parseBody(req, patchSchema);
    if (!body.ok) return body.response;
    try {
      return Response.json({ tag: await updateTag(session.organizationId, id, body.data) });
    } catch (err) {
      return tagErrorResponse(err);
    }
  },
  { permission: "tags.manage" }
);

/** 021 — Borra la etiqueta y sus asignaciones; los contactos NO se tocan. */
export const DELETE = withAuth(
  async (session, _req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    try {
      await deleteTag(session.organizationId, id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return tagErrorResponse(err);
    }
  },
  { permission: "tags.manage" }
);
