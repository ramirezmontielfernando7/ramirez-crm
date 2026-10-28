import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scopedContacts, type Access } from "@/lib/db/tenant";
import { getBranding } from "@/server/branding";

/**
 * Monto y prioridad del lead: lo que se captura SIN mover la tarjeta. Lo
 * comparten `PATCH /api/pipeline/leads/[id]` y la IA conectada (047), para
 * que las reglas (moneda del negocio, fecha de la prioridad) sean una.
 */
export type LeadFieldsInput = {
  /** Centavos enteros; `null` lo borra; ausente lo deja. */
  amountCents?: number | null;
  currency?: string | null;
  priority?: "alta" | "media" | "baja" | null;
};

/** Las columnas que cambian (vacío = nada que guardar). */
export async function leadFieldsPatch(organizationId: string, input: LeadFieldsInput): Promise<Record<string, unknown>> {
  const extra: Record<string, unknown> = {};
  if (input.amountCents !== undefined) {
    extra.amountCents = input.amountCents;
    // Sin monto no hay moneda que guardar: dejarla apuntando a un importe
    // borrado haría que el tablero contara un lead que ya no tiene número.
    extra.currency = input.amountCents === null ? null : (input.currency ?? (await getBranding(organizationId)).currency);
  }
  if (input.priority !== undefined) {
    extra.priority = input.priority;
    // La fecha acompaña al valor: sirve para saber si la decisión es de hoy o
    // de hace tres semanas, que es lo que vuelve útil mirarla.
    extra.priorityUpdatedAt = input.priority === null ? null : new Date();
  }
  return extra;
}

/** Guarda solo esos campos, en un lead que quien pide ve (020). null = no lo ve. */
export async function updateLeadFields(access: Access, leadId: string, extra: Record<string, unknown>) {
  const [row] = await getDb()
    .update(schema.lead)
    .set({ ...extra, updatedAt: new Date() })
    .where(scopedContacts(schema.lead.organizationId, access, schema.lead.contactId, eq(schema.lead.id, leadId)))
    .returning();
  return row ?? null;
}
