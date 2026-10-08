import { apiError, withAuth } from "@/lib/api";
import { kbDocsOff } from "@/server/kb-docs/flag";
import { documentView } from "@/server/kb-docs/http";
import { scheduleIndex } from "@/server/kb-docs/indexer";
import { requeueDocument } from "@/server/kb-docs/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 035 — Vuelve a fragmentar y embeber un documento (p. ej. tras un fallo o al encender el servicio de embeddings). */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  const { id } = await ctx.params;
  const doc = await requeueDocument(session.organizationId, id);
  if (!doc) return apiError(404, "not_found", "Documento no encontrado");
  scheduleIndex(session.organizationId, doc.id);
  return Response.json({ document: documentView(doc) }, { status: 202 });
}, { permission: "agent.manage" });
