import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scopedContacts, type Access } from "@/lib/db/tenant";
import { effectiveSource } from "@/server/contact-source";
import type { FichaDto, PriorityValue } from "@/lib/types";

export function serializeContact(
  c: typeof schema.contact.$inferSelect,
  stageName: string | null = null,
  priority: PriorityValue | null = null,
  /** 018: si llegó por un anuncio, la fuente no capturada se deduce "anuncio". */
  llegoPorAnuncio = false
) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    stageName,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    source: effectiveSource(c.source, llegoPorAnuncio),
    priority,
    /** 020: quién lo atiende; null = sin asignar. */
    assignedUserId: c.assignedUserId,
    assignedAt: c.assignedAt?.toISOString() ?? null,
    // Viaja siempre, aunque esté vacía: la pantalla necesita distinguir "aún
    // no la han llenado" de "este contacto no la trae".
    ficha: (c.ficha as FichaDto | null) ?? {},
  };
}

/** El contacto, SOLO si la sesión puede verlo (020); si no, null → 404. */
export async function getContactById(access: Access, contactId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      scopedContacts(
        schema.contact.organizationId,
        access,
        schema.contact.id,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Etapa actual del lead del contacto (si existe). */
export async function getContactStage(access: Access, contactId: string) {
  const db = getDb();
  const rows = await db
    .select({ stage: schema.pipelineStage, lead: schema.lead })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.lead.stageId, schema.pipelineStage.id)
    )
    .where(
      scopedContacts(
        schema.lead.organizationId,
        access,
        schema.lead.contactId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
