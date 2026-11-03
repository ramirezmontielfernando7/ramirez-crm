import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { THREAD_BULK_MAX } from "@/lib/assistant-engine";
import { archiveThreads, deleteThreads } from "@/server/assistant/threads";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

const body = z.object({
  action: z.enum(["archive", "unarchive", "delete"]),
  ids: z.array(z.string().min(1).max(64)).min(1).max(THREAD_BULK_MAX),
});

/** Archivar, desarchivar o borrar varios hilos propios de golpe. Solo toca las tablas del asistente. */
export const POST = withAuth(
  async (session, req: Request) => {
    const off = await moduleOff(session.organizationId, "asistente");
    if (off) return off;
    const parsed = await parseBody(req, body);
    if (!parsed.ok) return parsed.response;
    const { action, ids } = parsed.data;
    const n =
      action === "delete"
        ? await deleteThreads(session.organizationId, session.userId, ids)
        : await archiveThreads(session.organizationId, session.userId, ids, action === "archive");
    return Response.json({ ok: true, count: n });
  },
  { permission: "assistant.use" }
);
