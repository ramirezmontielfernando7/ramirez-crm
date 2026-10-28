import { z } from "zod";
import { ASSISTANT_NAME_MAX } from "@/lib/ai-connector";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { conectorIaOff } from "@/server/modules";
import { createPersonalKey, listMyConnections, mayConnect } from "@/server/ai-connector/keys";

export const dynamic = "force-dynamic";

/**
 * 047 PR 3 — Ajustes → IA conectada → Mi IA: las IAs que conectó QUIEN pide
 * (nunca las de otro) y su llave personal. Sin el complemento: 404.
 */
export const GET = withAuth(async (session) => {
  const off = await conectorIaOff(session.organizationId);
  if (off) return off;
  const [allowed, connections] = await Promise.all([mayConnect(session), listMyConnections(session)]);
  return Response.json({
    allowed,
    connectorUrl: `${getEnv().APP_BASE_URL.replace(/\/+$/, "")}/api/mcp`,
    connections,
  });
});

const postSchema = z.object({
  name: z.string().trim().min(1).max(80),
  write: z.boolean().default(false),
  /** «Joe»: cómo firma en la Bandeja; vacío = «Asistente». */
  assistantName: z.string().max(ASSISTANT_NAME_MAX).nullable().optional(),
});

/** Llave personal nueva: se muestra UNA vez; aquí solo queda su huella. */
export const POST = withAuth(async (session, req: Request) => {
  const off = await conectorIaOff(session.organizationId);
  if (off) return off;
  const parsed = await parseBody(req, postSchema);
  if (!parsed.ok) return parsed.response;
  const made = await createPersonalKey(session, {
    name: parsed.data.name,
    scopes: parsed.data.write ? ["read", "write"] : ["read"],
    assistantName: parsed.data.assistantName ?? null,
  });
  if (!made) return apiError(403, "connector_off", "El conector de IA está apagado para tu rol");
  return Response.json(made, { status: 201, headers: { "cache-control": "no-store" } });
});
