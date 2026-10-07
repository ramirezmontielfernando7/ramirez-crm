import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { createKbEntry, listKbEntries } from "@/server/agents/kb";
import { withAgentErrors } from "@/server/agents/http";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * 031 — `?agentId=`: el conocimiento PROPIO de ese agente. Sin él, el
 * compartido (antes de 031 todo era compartido: misma respuesta de siempre).
 */
export const GET = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "agent");
  if (off) return off;
  const agentId = new URL(req.url).searchParams.get("agentId") || null;
  const entries = await listKbEntries(session.organizationId, agentId);
  return Response.json({ entries });
}, { permission: "agent.manage" });

const agentField = { agentId: z.string().min(1).nullable().optional() };

const createSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("qa"),
      question: z.string().trim().min(1).max(500),
      answer: z.string().trim().min(1).max(4000),
      ...agentField,
    }),
    z.object({
      kind: z.literal("block"),
      content: z.string().trim().min(1).max(8000),
      ...agentField,
    }),
  ]);

export const POST = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "agent");
  if (off) return off;
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  return withAgentErrors(async () => {
    const entry = await createKbEntry(session.organizationId, body.data);
    return Response.json({ entry }, { status: 201 });
  });
}, { permission: "agent.manage" });
