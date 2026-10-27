import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { createLossReason, LABEL_MAX, listLossReasons } from "@/server/leads/loss-reasons";

export const dynamic = "force-dynamic";

/** Motivos de pérdida de la organización (activos y archivados; la pantalla filtra). */
export const GET = withAuth(async (session) => {
  return Response.json({ reasons: await listLossReasons(session.organizationId) });
});

const createSchema = z.object({ label: z.string().trim().min(1).max(LABEL_MAX) });

export const POST = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, createSchema);
    if (!body.ok) return body.response;
    const reason = await createLossReason(session.organizationId, body.data.label);
    return Response.json({ reason }, { status: 201 });
  },
  { permission: "pipeline.edit" }
);
