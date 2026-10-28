import { beforeOf } from "@/lib/ai-connector";
import { withAuth } from "@/lib/api";
import { conectorIaOff } from "@/server/modules";
import { listActions } from "@/server/ai-connector/log";

export const dynamic = "force-dynamic";

/**
 * 047 PR 5 — Ajustes del conector → «Qué hizo la IA del equipo»: lo de toda
 * la empresa, para quien decide los ajustes del conector. El nombre del
 * contacto solo si quien mira lo ve (un chat privado de «Mi número», nunca).
 */
export const GET = withAuth(
  async (session, req: Request) => {
    const off = await conectorIaOff(session.organizationId);
    if (off) return off;
    return Response.json(await listActions(session, { scope: "team", before: beforeOf(req) }));
  },
  { permission: "settings.manage" }
);
