import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { NOTE_BODY_MAX, NOTE_COLORS, NOTE_TITLE_MAX } from "@/lib/work";
import { moduleOff } from "@/server/modules";
import { viewerOf } from "@/server/work/tasks";
import { deleteNote, getNote, NoteInputError, updateNote } from "@/server/work/notes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 033, PR 2 — Una nota que quien pide puede ver; si no, 404. */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = await moduleOff(session.organizationId, "trabajo");
  if (off) return off;
  const { id } = await ctx.params;
  const note = await getNote(viewerOf(session), id);
  if (!note) return apiError(404, "not_found", "Nota no encontrada");
  return Response.json({ note });
});

const patchBody = z
  .object({
    title: z.string().max(NOTE_TITLE_MAX).nullable().optional(),
    body: z.string().max(NOTE_BODY_MAX).optional(),
    color: z.enum(NOTE_COLORS).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    contactId: z.string().min(1).nullable().optional(),
    conversationId: z.string().min(1).nullable().optional(),
  })
  .strict();

/**
 * Editar, fijar, archivar o cambiar la ligadura: quien la escribió o
 * `work.manage`. La que no se ve, 404; la que se ve pero no es suya, 403.
 */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const off = await moduleOff(session.organizationId, "trabajo");
  if (off) return off;
  const { id } = await ctx.params;
  const body = await parseBody(req, patchBody);
  if (!body.ok) return body.response;
  try {
    const note = await updateNote(viewerOf(session), id, body.data);
    if (note === "forbidden") return apiError(403, "forbidden", "Solo quien la escribió (o quien coordina) puede cambiar esta nota");
    if (!note) return apiError(404, "not_found", "Nota no encontrada");
    return Response.json({ note });
  } catch (err) {
    if (err instanceof NoteInputError) return apiError(422, err.code, err.message);
    throw err;
  }
});

/** Borrar: quien la escribió o `work.manage`. */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const off = await moduleOff(session.organizationId, "trabajo");
  if (off) return off;
  const { id } = await ctx.params;
  const done = await deleteNote(viewerOf(session), id);
  if (done === "forbidden") return apiError(403, "forbidden", "Solo quien la escribió (o quien coordina) puede borrar esta nota");
  if (!done) return apiError(404, "not_found", "Nota no encontrada");
  return new Response(null, { status: 204 });
});
