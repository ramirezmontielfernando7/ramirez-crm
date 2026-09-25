import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { logActivitySafe } from "@/server/activity/log";
import { scopedContacts } from "@/lib/db/tenant";
import {
  getContactById,
  getContactStage,
  serializeContact,
} from "@/server/contacts";
import { upsertFicha } from "@/server/bot/ficha";
import { cuentaComoAnuncio } from "@/lib/anuncios";
import { WA_CONSENT_VALUES } from "@/lib/tags";
import { tagsForContacts } from "@/server/tags/tags";
import {
  anuncioDelContacto,
  repararImagenSiFalta,
} from "@/server/attribution/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const contact = await getContactById(session.access, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");
  const [stageRow, anuncio, tags] = await Promise.all([
    getContactStage(session.access, id),
    anuncioDelContacto(session.organizationId, id),
    tagsForContacts(session.organizationId, [id]),
  ]);
  // 018 — Sin imagen todavía: se reintenta en segundo plano y llega por SSE.
  if (anuncio && !anuncio.imageAssetId) {
    repararImagenSiFalta(session.organizationId, id);
  }
  return Response.json({
    contact: serializeContact(
      contact,
      null,
      null,
      cuentaComoAnuncio(anuncio),
      tags.get(id) ?? []
    ),
    // 018 — de qué anuncio llegó, o null si escribió por su cuenta.
    anuncio,
    stage: stageRow
      ? {
          id: stageRow.stage.id,
          name: stageRow.stage.name,
          position: stageRow.stage.position,
          kind: stageRow.stage.kind,
        }
      : null,
    lead: stageRow ? { id: stageRow.lead.id } : null,
  });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(4000).nullable().optional(),
  archived: z.boolean().optional(),
  /**
   * Parche de la ficha: solo las claves que cambian. `null` borra una clave.
   * No es un reemplazo — el agente sigue escribiendo mientras el dueño
   * corrige, y mandar la ficha entera haría que el último en guardar le
   * borrara lo recién descubierto al otro.
   */
  ficha: z.record(z.unknown()).optional(),
  /**
   * 021 — Consentimiento para envíos masivos. Solo una persona lo cambia
   * aquí; es la única vía que puede revertir un `opt_out` (la importación no).
   */
  waConsent: z.enum(WA_CONSENT_VALUES).optional(),
  waConsentSource: z.string().trim().max(200).nullable().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  // 020: el contacto de otro asesor no existe para este (404), y eso vale
  // también para la ficha, que va por otra puerta.
  const previous = await getContactById(session.access, id);
  if (!previous) {
    return apiError(404, "not_found", "Contacto no encontrado");
  }

  // La ficha va por su propia puerta —la MISMA que usa el cerebro externo en
  // `PUT /api/bot/ficha`— para heredar el merge y las cotas. Escribirla aquí
  // con un `set` plano sería un segundo camino con otras reglas.
  if (body.data.ficha !== undefined) {
    const res = await upsertFicha({
      organizationId: session.organizationId,
      contactId: id,
      ficha: body.data.ficha,
    });
    if (!res) return apiError(404, "not_found", "Contacto no encontrado");
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.name !== undefined) {
    set.name = body.data.name;
    // Lo escribio una persona: a partir de aqui WhatsApp ya no lo pisa (#51).
    set.nameSource = "manual";
  }
  if (body.data.notes !== undefined) set.notes = body.data.notes;
  if (body.data.archived !== undefined) {
    set.archivedAt = body.data.archived ? new Date() : null;
  }
  if (body.data.waConsent !== undefined) {
    set.waConsent = body.data.waConsent;
    set.waConsentAt = new Date();
    // Sin origen explícito, queda registrado que lo cambió una persona.
    if (body.data.waConsentSource === undefined) set.waConsentSource = "Cambio manual en el CRM";
  }
  if (body.data.waConsentSource !== undefined) {
    set.waConsentSource = body.data.waConsentSource || null;
  }

  const db = getDb();
  const updated = await db
    .update(schema.contact)
    .set(set)
    .where(
      scopedContacts(
        schema.contact.organizationId,
        session.access,
        schema.contact.id,
        eq(schema.contact.id, id)
      )
    )
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Contacto no encontrado");
  // 022: el cambio de consentimiento queda en la línea de tiempo.
  if (body.data.waConsent !== undefined && body.data.waConsent !== previous.waConsent) {
    await logActivitySafe({
      organizationId: session.organizationId,
      contactId: id,
      kind: "consent_changed",
      actorUserId: session.userId,
      source: "usuario",
      detail: {
        from: previous.waConsent,
        to: updated[0].waConsent,
        source: updated[0].waConsentSource,
      },
    });
  }
  const [anuncio, tags] = await Promise.all([
    anuncioDelContacto(session.organizationId, id),
    tagsForContacts(session.organizationId, [id]),
  ]);
  return Response.json({
    contact: serializeContact(
      updated[0],
      null,
      null,
      cuentaComoAnuncio(anuncio),
      tags.get(id) ?? []
    ),
  });
});
