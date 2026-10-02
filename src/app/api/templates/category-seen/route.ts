import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { markCategoryChangeSeen } from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

/** Campañas v2 — "Entendido" en el aviso de que Meta cambió la categoría de una plantilla. */
const schema = z.object({ templateIds: z.array(z.string().min(1).max(64)).min(1).max(200) });

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const updated = await markCategoryChangeSeen(session.organizationId, body.data.templateIds);
  return Response.json({ updated });
}, { permission: "templates.manage" });
