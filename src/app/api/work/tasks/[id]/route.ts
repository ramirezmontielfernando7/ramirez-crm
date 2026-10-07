import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { TASK_DESCRIPTION_MAX, TASK_TITLE_MAX } from "@/lib/work";
import { moduleOff } from "@/server/modules";
import { deleteTask, TaskInputError, updateTask, viewerOf } from "@/server/work/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchBody = z
  .object({
    title: z.string().trim().min(1, "El título es obligatorio").max(TASK_TITLE_MAX).optional(),
    description: z.string().trim().max(TASK_DESCRIPTION_MAX).nullable().optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    assigneeUserId: z.string().min(1).nullable().optional(),
    contactId: z.string().min(1).nullable().optional(),
    conversationId: z.string().min(1).nullable().optional(),
    done: z.boolean().optional(),
  })
  .strict();

/**
 * 033 — Editar o marcar hecha/pendiente: quien la creó, su responsable o
 * `work.manage`. Una tarea que no se puede ver responde 404 (no existe para
 * quien pide); una que se ve pero no se puede tocar, 403.
 */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const off = await moduleOff(session.organizationId, "trabajo");
  if (off) return off;
  const { id } = await ctx.params;
  const body = await parseBody(req, patchBody);
  if (!body.ok) return body.response;
  const { dueAt, ...rest } = body.data;
  try {
    const task = await updateTask(viewerOf(session), id, {
      ...rest,
      dueAt: dueAt === undefined ? undefined : dueAt === null ? null : new Date(dueAt),
    });
    if (task === "forbidden") return apiError(403, "forbidden", "No puedes cambiar esta tarea");
    if (!task) return apiError(404, "not_found", "Tarea no encontrada");
    return Response.json({ task });
  } catch (err) {
    if (err instanceof TaskInputError) return apiError(422, err.code, err.message);
    throw err;
  }
});

/** Borrar: quien la creó o `work.manage`. */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = await moduleOff(session.organizationId, "trabajo");
  if (off) return off;
  const { id } = await ctx.params;
  const done = await deleteTask(viewerOf(session), id);
  if (done === "forbidden") return apiError(403, "forbidden", "No puedes borrar esta tarea");
  if (!done) return apiError(404, "not_found", "Tarea no encontrada");
  return new Response(null, { status: 204 });
});
