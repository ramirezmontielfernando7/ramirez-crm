import { apiError, withAuth } from "@/lib/api";
import { closeUploadLink, findUploadLink } from "@/server/ai-connector/upload-links";
import { conectorIaOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 047 — «Listo»: el enlace deja de recibir archivos. Solo el propio. */
export const POST = withAuth(async (session, _req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const off = await conectorIaOff(session.organizationId);
  if (off) return off;
  const { token } = await ctx.params;
  const link = await findUploadLink(session.organizationId, session.userId, token);
  if (!link) return apiError(404, "not_found", "Este enlace no existe o no es tuyo");
  await closeUploadLink(session.organizationId, link.id);
  return new Response(null, { status: 204 });
}, { permission: "knowledge.manage" });
