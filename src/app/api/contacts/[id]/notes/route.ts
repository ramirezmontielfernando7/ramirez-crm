import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getContactById } from "@/server/contacts";
import { logActivity } from "@/server/activity/log";
import { publish } from "@/server/events/bus";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ text: z.string().trim().min(1).max(4000) });

/**
 * 022 — Añade una nota a la línea de tiempo, con autor y hora. Las notas ya
 * no se sobrescriben: cada una es un evento. Lo que había en `contact.notes`
 * sigue ahí y se muestra como "Nota inicial".
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  // 020: el contacto de otro asesor no existe para este.
  if (!(await getContactById(session.access, id))) {
    return apiError(404, "not_found", "Contacto no encontrado");
  }
  const row = await logActivity({
    organizationId: session.organizationId,
    contactId: id,
    kind: "note_added",
    actorUserId: session.userId,
    source: "usuario",
    detail: { text: body.data.text },
  });

  // Quien tenga este chat abierto ve la nota aparecer sin recargar: el panel
  // refresca su línea de tiempo con cada `conversation.updated`.
  const conversations = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      // scoped-ok: el contacto ya pasó por getContactById (scopedContacts);
      // aquí solo se buscan los ids de sus conversaciones para avisar por SSE.
      scoped(
        schema.conversation.organizationId,
        session.organizationId,
        and(eq(schema.conversation.contactId, id), eq(schema.conversation.isTest, false))
      )
    );
  for (const c of conversations) {
    publish(session.organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: c.id } },
    });
  }
  return Response.json({ id: row.id, occurredAt: row.occurredAt.toISOString() }, { status: 201 });
});
