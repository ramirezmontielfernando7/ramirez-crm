import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { NOTE_BODY_MAX, NOTE_COLORS, NOTE_TITLE_MAX } from "@/lib/work";
import { moduleOff } from "@/server/modules";
import { viewerOf } from "@/server/work/tasks";
import { createNote, listContactNotes, listMyNotes, NoteInputError } from "@/server/work/notes";

export const dynamic = "force-dynamic";

/**
 * 033, PR 2 — Notas (módulo «Trabajo», clave `trabajo`). Cualquier rol.
 * Sin parámetros: las que escribió quien pide (`?archived=1`, las
 * archivadas). `?contactId=`: las ligadas a ese contacto, solo si quien pide
 * lo puede ver (si no, 404, igual que la Bandeja).
 */
export const GET = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "trabajo");
  if (off) return off;
  const url = new URL(req.url);
  const v = viewerOf(session);
  const contactId = url.searchParams.get("contactId");
  if (contactId) {
    const notes = await listContactNotes(v, contactId);
    if (!notes) return apiError(404, "not_found", "Contacto no encontrado");
    return Response.json({ notes });
  }
  return Response.json({ notes: await listMyNotes(v, { archived: url.searchParams.get("archived") === "1" }) });
});

const noteBody = z
  .object({
    title: z.string().max(NOTE_TITLE_MAX).nullable().optional(),
    body: z.string().max(NOTE_BODY_MAX).optional(),
    color: z.enum(NOTE_COLORS).optional(),
    contactId: z.string().min(1).nullable().optional(),
    conversationId: z.string().min(1).nullable().optional(),
  })
  .strict();

/** Crear: cualquier rol. Ligada a un chat solo si quien escribe lo puede ver. */
export const POST = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "trabajo");
  if (off) return off;
  const body = await parseBody(req, noteBody);
  if (!body.ok) return body.response;
  try {
    const note = await createNote(viewerOf(session), body.data);
    return Response.json({ note }, { status: 201 });
  } catch (err) {
    if (err instanceof NoteInputError) return apiError(422, err.code, err.message);
    throw err;
  }
});
