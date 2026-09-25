import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getContactById } from "@/server/contacts";
import { setContactTags, TAG_ERROR_STATUS, TagError } from "@/server/tags/tags";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  tagIds: z.array(z.string().min(1)).max(50),
});

/**
 * 021 — Deja al contacto con exactamente estas etiquetas. Etiquetar es
 * trabajo diario (un asesor marca a SU cliente como "VIP"): basta con poder
 * ver el contacto. Crear o borrar etiquetas es otra cosa (`tags.manage`).
 */
export const PUT = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  // 020: el contacto de otro asesor no existe para este.
  if (!(await getContactById(session.access, id))) {
    return apiError(404, "not_found", "Contacto no encontrado");
  }
  try {
    const tags = await setContactTags(session.organizationId, id, body.data.tagIds, session.userId);
    return Response.json({ tags });
  } catch (err) {
    if (err instanceof TagError) return apiError(TAG_ERROR_STATUS[err.code], err.code, err.message);
    throw err;
  }
});
