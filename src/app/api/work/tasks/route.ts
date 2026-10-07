import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isTaskFilter, TASK_DESCRIPTION_MAX, TASK_TITLE_MAX } from "@/lib/work";
import { moduleOff } from "@/server/modules";
import { createTask, listTasks, TaskInputError, viewerOf } from "@/server/work/tasks";

export const dynamic = "force-dynamic";

/**
 * 033 — Tareas (módulo «Trabajo», clave `trabajo`). Cualquier rol: cada quien
 * ve lo que creó o tiene a su cargo; con `work.manage` (Propietario y
 * Coordinador), las de todo el equipo. `?filter=mine|all|overdue|done`,
 * `?contactId=` para las de un contacto.
 */
export const GET = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "trabajo");
  if (off) return off;
  const url = new URL(req.url);
  const raw = url.searchParams.get("filter") ?? "mine";
  if (!isTaskFilter(raw)) return apiError(422, "invalid_filter", "Filtro desconocido");
  const tasks = await listTasks(viewerOf(session), {
    filter: raw,
    contactId: url.searchParams.get("contactId") ?? undefined,
  });
  return Response.json({ tasks });
});

const taskBody = z.object({
  title: z.string().trim().min(1, "El título es obligatorio").max(TASK_TITLE_MAX),
  description: z.string().trim().max(TASK_DESCRIPTION_MAX).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  assigneeUserId: z.string().min(1).nullable().optional(),
  contactId: z.string().min(1).nullable().optional(),
  conversationId: z.string().min(1).nullable().optional(),
});

/** Crear: cualquier rol. Sin responsable elegido, queda a cargo de quien la anota. */
export const POST = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "trabajo");
  if (off) return off;
  const body = await parseBody(req, taskBody.strict());
  if (!body.ok) return body.response;
  const { dueAt, ...rest } = body.data;
  try {
    const task = await createTask(viewerOf(session), {
      ...rest,
      dueAt: dueAt === undefined ? undefined : dueAt === null ? null : new Date(dueAt),
    });
    return Response.json({ task }, { status: 201 });
  } catch (err) {
    if (err instanceof TaskInputError) return apiError(422, err.code, err.message);
    throw err;
  }
});
