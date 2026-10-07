import { apiError, withAuth } from "@/lib/api";
import { renderKb } from "@/server/ai/prompts";
import { ensureGeneralAgent } from "@/server/agents/ensure";
import { kbForConfig } from "@/server/agents/resolve";
import { getAgent } from "@/server/agents/store";
import { emptyConfig } from "@/server/agents/config";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * Tamaño estimado del knowledge base (FR-020). v1 inyecta el KB completo al
 * prompt; umbral de aviso heurístico: ~24.000 caracteres (≈6k tokens).
 *
 * 031: el tamaño de lo que LEE un agente (`?agentId=`; sin él, el general):
 * el compartido, si lo usa, más el suyo.
 */
const WARN_CHARS = 24_000;

export const GET = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "agent");
  if (off) return off;
  const agentId = new URL(req.url).searchParams.get("agentId");
  let entries: { kind: "qa" | "block"; question: string | null; answer: string | null; content: string | null }[];
  if (agentId) {
    const agent = await getAgent(session.organizationId, agentId);
    if (!agent) return apiError(404, "not_found", "Agente no encontrado");
    entries = await kbForConfig(session.organizationId, agent, agent.draft);
  } else {
    const general = await ensureGeneralAgent(session.organizationId);
    entries = general
      ? await kbForConfig(session.organizationId, { id: general.agent.id, isGeneral: true }, general.published ?? emptyConfig())
      : [];
  }
  const chars = renderKb(entries).length;
  return Response.json({
    chars,
    warnAt: WARN_CHARS,
    warning: chars >= WARN_CHARS,
  });
}, { permission: "agent.manage" });
