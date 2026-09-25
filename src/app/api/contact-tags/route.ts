import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { TAG_COLORS } from "@/lib/tags";
import { createTag, listTags, TAG_ERROR_STATUS, TagError } from "@/server/tags/tags";

export const dynamic = "force-dynamic";

/** 021 — Etiquetas del negocio. Leerlas: cualquier rol (para filtrar y etiquetar). */
export const GET = withAuth(async (session) => {
  return Response.json({ tags: await listTags(session.organizationId) });
});

const createSchema = z.object({
  name: z.string().max(200),
  color: z.enum(TAG_COLORS).nullable().optional(),
});

export const POST = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, createSchema);
    if (!body.ok) return body.response;
    try {
      const tag = await createTag(session.organizationId, body.data);
      return Response.json({ tag }, { status: 201 });
    } catch (err) {
      if (err instanceof TagError) return apiError(TAG_ERROR_STATUS[err.code], err.code, err.message);
      throw err;
    }
  },
  { permission: "tags.manage" }
);
