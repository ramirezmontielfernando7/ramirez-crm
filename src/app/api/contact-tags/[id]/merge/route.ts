import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { mergeImpact, mergeTags, TAG_ERROR_STATUS, TagError } from "@/server/tags/tags";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function tagErrorResponse(err: unknown): Response {
  if (err instanceof TagError) return apiError(TAG_ERROR_STATUS[err.code], err.code, err.message);
  throw err;
}

/**
 * Etiquetas limpias — Cuánto afecta fusionar esta etiqueta (`[id]`, el origen)
 * en `?targetId=`: contactos que pasan, cuántos ya la tienen y bases de
 * Audiencias que cambian. No escribe nada.
 */
export const GET = withAuth(
  async (session, req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    const targetId = new URL(req.url).searchParams.get("targetId") ?? "";
    if (!targetId) return apiError(422, "invalid", "Falta la etiqueta destino (targetId)");
    try {
      return Response.json({ impact: await mergeImpact(session.organizationId, id, targetId) });
    } catch (err) {
      return tagErrorResponse(err);
    }
  },
  { permission: "tags.manage" }
);

const bodySchema = z.object({ targetId: z.string().min(1).max(64) }).strict();

/**
 * Etiquetas limpias — Fusiona esta etiqueta (`[id]`) EN `targetId`. Una etiqueta
 * de sistema no puede ser el destino (409). Todo en una transacción.
 */
export const POST = withAuth(
  async (session, req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;
    try {
      return Response.json(await mergeTags(session.organizationId, id, body.data.targetId, session.userId));
    } catch (err) {
      return tagErrorResponse(err);
    }
  },
  { permission: "tags.manage" }
);
