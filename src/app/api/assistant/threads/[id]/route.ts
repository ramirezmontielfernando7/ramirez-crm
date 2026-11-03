import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { archiveThreads, deleteThreads, getThreadMessages } from "@/server/assistant/threads";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 038 (PR 2) — Los mensajes de UNA conversación del asistente, con sus fuentes. Solo de quien la abrió (404 si no). */
export const GET = withAuth(
  async (session, _req: Request, ctx: Params) => {
    const off = await moduleOff(session.organizationId, "asistente");
    if (off) return off;
    const { id } = await ctx.params;
    const messages = await getThreadMessages(session.organizationId, session.userId, id);
    if (!messages) return apiError(404, "not_found", "Conversación no encontrada");
    return Response.json({ messages });
  },
  { permission: "assistant.use" }
);

/** Borrar una conversación propia (solo afecta las tablas del asistente). */
export const DELETE = withAuth(
  async (session, _req: Request, ctx: Params) => {
    const off = await moduleOff(session.organizationId, "asistente");
    if (off) return off;
    const { id } = await ctx.params;
    const n = await deleteThreads(session.organizationId, session.userId, [id]);
    if (n === 0) return apiError(404, "not_found", "Conversación no encontrada");
    return Response.json({ ok: true });
  },
  { permission: "assistant.use" }
);

/** Archivar o desarchivar una conversación propia. */
export const PATCH = withAuth(
  async (session, req: Request, ctx: Params) => {
    const off = await moduleOff(session.organizationId, "asistente");
    if (off) return off;
    const { id } = await ctx.params;
    const parsed = await parseBody(req, z.object({ archived: z.boolean() }));
    if (!parsed.ok) return parsed.response;
    const n = await archiveThreads(session.organizationId, session.userId, [id], parsed.data.archived);
    if (n === 0) return apiError(404, "not_found", "Conversación no encontrada");
    return Response.json({ ok: true });
  },
  { permission: "assistant.use" }
);
