import { beforeOf } from "@/lib/ai-connector";
import { withAuth } from "@/lib/api";
import { conectorIaOff } from "@/server/modules";
import { listActions } from "@/server/ai-connector/log";

export const dynamic = "force-dynamic";

/**
 * 047 PR 5 — Mi IA → «Qué hizo tu IA»: lo que hizo la IA de QUIEN pide
 * (nunca la de otro), sin texto de mensajes. Sin el complemento: 404.
 */
export const GET = withAuth(async (session, req: Request) => {
  const off = await conectorIaOff(session.organizationId);
  if (off) return off;
  return Response.json(await listActions(session, { scope: "mine", before: beforeOf(req) }));
});
