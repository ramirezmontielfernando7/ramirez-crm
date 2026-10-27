import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { LABEL_MAX, updateLossReason } from "@/server/leads/loss-reasons";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  label: z.string().trim().min(1).max(LABEL_MAX).optional(),
  active: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

/** Renombrar, reordenar o archivar/recuperar. Nunca se borra: el historial lo usa. */
export const PATCH = withAuth(
  async (session, req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    const body = await parseBody(req, patchSchema);
    if (!body.ok) return body.response;
    const res = await updateLossReason(session.organizationId, id, body.data);
    if (res === null) return apiError(404, "not_found", "Motivo no encontrado");
    if (res === "protected") {
      return apiError(422, "protected_reason", "«Otro» no se puede quitar: el sistema lo usa al mover tratos");
    }
    return Response.json({ reason: res });
  },
  { permission: "pipeline.edit" }
);
