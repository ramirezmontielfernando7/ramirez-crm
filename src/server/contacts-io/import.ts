import { eq, inArray } from "drizzle-orm";
import { getDb, schema, type Db } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { normalizeTagName, type WaConsent } from "@/lib/tags";
import { createLeadForContact } from "@/server/inbox/lead-activity";
import {
  ImportError,
  validateImport,
  type RowFailure,
  type ValidationResult,
  type ValidRow,
} from "@/server/contacts-io/validate";

/**
 * 021 — Importación de contactos desde CSV.
 *
 * Reglas (spec 021, decisiones del dueño):
 * - Dedupe por (organización, canal whatsapp, wa_identity) — la llave única
 *   de `contact` —, con el teléfono normalizado por `normalizeMx`.
 * - Contacto nuevo: consentimiento `desconocido` salvo que el CSV lo traiga.
 * - Contacto existente: solo se llenan los campos VACÍOS (teléfono, fuente);
 *   el nombre no se toca. El consentimiento del CSV se aplica, EXCEPTO sobre
 *   un `opt_out`: pedir la baja no se revierte con una base vieja.
 * - Todos los contactos del archivo (nuevos y existentes) reciben la etiqueta
 *   del import, para saber después de qué base vino cada uno.
 * - Todo o nada: si la BD falla a la mitad, no queda una importación parcial.
 */

export type ImportSummary = {
  totalRows: number;
  created: number;
  updated: number;
  failed: number;
  emptyRows: number;
  tag: { id: string; name: string };
  /** Detalle por fila de lo que NO se importó (para el CSV descargable). */
  failures: RowFailure[];
  /** Filas importadas con una salvedad (p. ej. opt_out conservado). */
  warnings: RowFailure[];
  leadsCreated: number;
};

/** Nombre de la etiqueta del import: la que eligió el usuario o "Import: archivo.csv". */
export function importTagName(fileName: string, chosen?: string | null): string {
  const fromUser = chosen ? normalizeTagName(chosen) : null;
  if (fromUser) return fromUser;
  const base = fileName.replace(/[\\/]/g, " ").trim() || "archivo.csv";
  return normalizeTagName(`Import: ${base}`.slice(0, 60)) ?? "Import";
}

const CHUNK = 500;

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function importContacts(input: {
  organizationId: string;
  actorUserId: string;
  fileName: string;
  text: string;
  tagName?: string | null;
  createLeads?: boolean;
}): Promise<ImportSummary> {
  return importValidated({ ...input, validation: validateImport(input.text) });
}

/** Un contacto de la importación (nuevo o existente) y su fila del archivo. */
export type ImportedMember = { contactId: string; row: ValidRow; created: boolean };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * El núcleo de la importación, sobre filas YA validadas (de CSV o de Excel).
 *
 * Campañas v2 (PR 2):
 * - `consentDeclaration`: lo que la persona declaró sobre cómo obtuvo el
 *   consentimiento de esta base. Con él, las filas que no traen columna de
 *   consentimiento quedan `opt_in` con esa declaración como origen (un
 *   `opt_out` sigue sin revertirse).
 * - `onMembers`: corre DENTRO de la misma transacción con cada contacto y su
 *   fila (la base guardada de Audiencias se escribe todo o nada).
 * - El correo solo llena un correo vacío.
 */
export async function importValidated(input: {
  organizationId: string;
  actorUserId: string;
  fileName: string;
  validation: ValidationResult;
  tagName?: string | null;
  createLeads?: boolean;
  consentDeclaration?: string | null;
  onMembers?: (tx: Tx, members: ImportedMember[], tag: { id: string; name: string }) => Promise<void>;
}): Promise<ImportSummary> {
  const { organizationId, validation } = input;
  const tagName = importTagName(input.fileName, input.tagName);
  const declaration = input.consentDeclaration?.trim().slice(0, 200) || null;
  /** El consentimiento que se aplica a una fila: el del archivo, o el declarado. */
  const consentOf = (row: ValidRow): WaConsent | null => row.waConsent ?? (declaration ? "opt_in" : null);
  const sourceOf = (row: ValidRow): string =>
    row.waConsentSource ?? (!row.waConsent && declaration ? declaration : consentSource(row, input.fileName));
  if (validation.rows.length === 0 && validation.failures.length === 0) {
    throw new ImportError("empty", "El archivo solo tiene la cabecera: no hay contactos que importar");
  }

  const warnings: RowFailure[] = [...validation.warnings];
  const createdIds: string[] = [];
  const members: ImportedMember[] = [];
  let updated = 0;
  const db = getDb();

  const importTag = await db.transaction(async (tx) => {
    // Etiquetas: la del import + las que traiga cada fila, creadas si faltan.
    const allTagNames = new Set<string>([tagName]);
    for (const r of validation.rows) for (const t of r.tags) allTagNames.add(t);
    const tagNames = [...allTagNames];
    for (const names of chunks(tagNames)) {
      await tx
        .insert(schema.contactTag)
        .values(names.map((name) => ({ id: newId("contactTag"), organizationId, name })))
        .onConflictDoNothing({ target: [schema.contactTag.organizationId, schema.contactTag.name] });
    }
    const tagIdByName = new Map<string, string>();
    for (const names of chunks(tagNames)) {
      const found = await tx
        .select({ id: schema.contactTag.id, name: schema.contactTag.name })
        .from(schema.contactTag)
        .where(scoped(schema.contactTag.organizationId, organizationId, inArray(schema.contactTag.name, names)));
      for (const t of found) tagIdByName.set(t.name, t.id);
    }
    const importTagId = tagIdByName.get(tagName);
    if (!importTagId) throw new Error(`importContacts: la etiqueta "${tagName}" no quedó creada`);

    const assignments: { contactId: string; tagId: string }[] = [];
    const now = new Date();

    for (const batch of chunks(validation.rows)) {
      // scoped-ok: importar es de quien ve todo (permiso contacts.import).
      const existing = await tx
        .select()
        .from(schema.contact)
        .where(
          scoped(
            schema.contact.organizationId,
            organizationId,
            eq(schema.contact.channel, "whatsapp"),
            inArray(
              schema.contact.waIdentity,
              batch.map((r) => r.phone)
            )
          )
        );
      const byIdentity = new Map(existing.map((c) => [c.waIdentity, c]));

      const toInsert: (ValidRow & { id: string })[] = [];
      for (const row of batch) {
        const current = byIdentity.get(row.phone);
        if (!current) {
          toInsert.push({ ...row, id: newId("contact") });
          continue;
        }
        const set: Partial<typeof schema.contact.$inferInsert> = {};
        if (!current.phone) set.phone = row.phone;
        if (!current.source && row.source) set.source = row.source;
        if (!current.email && row.email) set.email = row.email;
        const consent = consentOf(row);
        if (consent && consent !== current.waConsent) {
          if (current.waConsent === "opt_out") {
            warnings.push({
              line: row.line,
              name: row.name,
              phone: row.phone,
              reason: `Se conservó "No quiere mensajes": el archivo decía ${consent}, y una baja solo se revierte a mano`,
            });
          } else {
            set.waConsent = consent;
            set.waConsentAt = now;
            set.waConsentSource = sourceOf(row);
          }
        }
        if (Object.keys(set).length > 0) {
          set.updatedAt = now;
          await tx
            .update(schema.contact)
            .set(set)
            .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, current.id)));
        }
        updated++;
        members.push({ contactId: current.id, row, created: false });
        assignments.push({ contactId: current.id, tagId: importTagId });
        for (const t of row.tags) assignments.push({ contactId: current.id, tagId: tagIdByName.get(t)! });
      }

      if (toInsert.length > 0) {
        const inserted = await tx
          .insert(schema.contact)
          .values(
            toInsert.map((r) => ({
              id: r.id,
              organizationId,
              channel: "whatsapp" as const,
              waIdentity: r.phone,
              phone: r.phone,
              name: r.name,
              // Lo escribió una persona (en su base): WhatsApp no lo pisa.
              nameSource: "manual" as const,
              source: r.source,
              email: r.email,
              waConsent: (consentOf(r) ?? "desconocido") as WaConsent,
              waConsentSource: sourceOf(r),
              waConsentAt: consentOf(r) ? now : null,
            }))
          )
          // Una carrera con el webhook (el cliente escribió justo ahora) no
          // tumba la importación: esa fila ya existe y se cuenta como tal.
          .onConflictDoNothing({
            target: [schema.contact.organizationId, schema.contact.channel, schema.contact.waIdentity],
          })
          .returning({ id: schema.contact.id, waIdentity: schema.contact.waIdentity });
        const insertedIds = new Set(inserted.map((c) => c.id));
        for (const r of toInsert) {
          if (insertedIds.has(r.id)) {
            createdIds.push(r.id);
            members.push({ contactId: r.id, row: r, created: true });
            assignments.push({ contactId: r.id, tagId: importTagId });
            for (const t of r.tags) assignments.push({ contactId: r.id, tagId: tagIdByName.get(t)! });
          } else {
            warnings.push({
              line: r.line,
              name: r.name,
              phone: r.phone,
              reason: "El contacto se creó en paralelo (llegó un mensaje suyo): se conservó el existente sin etiquetar",
            });
          }
        }
      }
    }

    for (const batch of chunks(assignments)) {
      await tx
        .insert(schema.contactTagAssignment)
        .values(batch.map((a) => ({ organizationId, ...a })))
        .onConflictDoNothing();
    }
    const tag = { id: importTagId, name: tagName };
    if (input.onMembers) await input.onMembers(tx, members, tag);
    return tag;
  });

  // Leads fuera de la transacción: son opcionales y cada uno es independiente.
  let leadsCreated = 0;
  if (input.createLeads) {
    for (const contactId of createdIds) {
      const lead = await createLeadForContact({
        organizationId,
        contactId,
        source: "dueno",
        actorUserId: input.actorUserId,
      });
      if (!lead) break; // sin etapas abiertas: ninguno más podrá crearse
      leadsCreated++;
    }
  }

  return {
    totalRows: validation.totalRows,
    created: createdIds.length,
    updated,
    failed: validation.failures.length,
    emptyRows: validation.emptyRows,
    tag: importTag,
    failures: validation.failures,
    warnings,
    leadsCreated,
  };
}

function consentSource(row: ValidRow, fileName: string): string {
  if (row.waConsentSource) return row.waConsentSource;
  return row.waConsent ? `Importado de ${fileName}` : `Importado sin verificar (${fileName})`.slice(0, 200);
}
