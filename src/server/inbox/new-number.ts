import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped, scopedContacts, type Access } from "@/lib/db/tenant";
import { can } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { normalizeTypedPhone } from "@/lib/phone-search";
import { createContactWithLead, getContactById } from "@/server/contacts";
import { logActivity } from "@/server/activity/log";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { sendTemplate } from "@/server/whatsapp/templates";
import { assertOrgActive } from "@/server/platform-admin/org-status";

/**
 * «Número no registrado» (búsqueda de la Bandeja): registrar el contacto,
 * abrir su chat y mandarle una plantilla. Aquí NO hay lógica de envío ni de
 * validación nueva: el alta es la de `POST /api/contacts`
 * (`createContactWithLead`), la conversación la de la ingesta
 * (`getOrCreateConversation`) y el envío es `sendTemplate`, el mismo de las
 * campañas (aprobada y activa, sandbox, estado de la organización, ventana).
 *
 * Lo ÚNICO que se decide aquí es el consentimiento antes de escribirle
 * primero a alguien: ver `sendFirstTemplate`.
 */

type Who = Pick<SessionContext, "organizationId" | "userId" | "role" | "grants" | "access">;

export class NewNumberError extends Error {
  code:
    | "invalid_phone"
    | "forbidden_contact"
    | "no_stage"
    | "bad_assignee"
    | "consent_required"
    | "opted_out"
    | "not_found";
  status: number;
  constructor(code: NewNumberError["code"], message: string, status: number) {
    super(message);
    this.name = "NewNumberError";
    this.code = code;
    this.status = status;
  }
}

/** Lo que un asesor sin acceso al contacto de otro ve: igual que `POST /api/contacts`. */
const GENERICO = "No se pudo registrar el contacto, verifica los datos e intenta de nuevo";

type ContactRow = typeof schema.contact.$inferSelect;

/** El contacto de WhatsApp con ese número, SOLO si la sesión puede verlo. */
async function visibleByPhone(access: Access, phone: string): Promise<ContactRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.contact)
    .where(
      scopedContacts(
        schema.contact.organizationId,
        access,
        schema.contact.id,
        eq(schema.contact.channel, "whatsapp"),
        eq(schema.contact.waIdentity, phone)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Registra el contacto del número tecleado — o devuelve el que ya existe
 * (sin duplicar, aunque lo hayan escrito con otro formato: 521…, 52…, +52 …).
 * Un contacto que existe pero la sesión no puede ver responde como un dato
 * inválido, sin confirmar que el número está en la base (020).
 */
export async function registerContact(
  session: Who,
  input: {
    phone: string;
    name?: string | null;
    stageId?: string;
    assignToUserId?: string | null;
  }
): Promise<{ contact: ContactRow; created: boolean }> {
  const typed = normalizeTypedPhone(input.phone);
  if (!typed.valid) {
    throw new NewNumberError("invalid_phone", typed.problem ?? "Teléfono no válido", 422);
  }
  const existing = await visibleByPhone(session.access, typed.phone);
  if (existing) return { contact: existing, created: false };

  // Quien no reparte no puede elegir a quién se lo asigna: se lo queda.
  const assignTo = can(session, "assignment.manage") ? (input.assignToUserId ?? null) : null;
  // Sin nombre, el nombre ES el teléfono (como hace la ingesta): jamás vacío.
  // Si luego el cliente escribe, su nombre de WhatsApp lo reemplaza solo
  // (`name_source` = perfil).
  const created = await createContactWithLead({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    seesAll: session.access.seesAll,
    name: input.name?.trim() || typed.phone,
    phone: typed.phone,
    stageId: input.stageId,
    assignToUserId: assignTo,
  });
  if (created.ok) return { contact: created.contact, created: true };
  if (created.reason === "no_stage") {
    throw new NewNumberError(
      "no_stage",
      "El tablero no tiene etapas abiertas donde colocar al prospecto",
      422
    );
  }
  if (created.reason === "assignee_not_member") {
    throw new NewNumberError("bad_assignee", "Esa persona no es del equipo", 422);
  }
  // Duplicado por carrera: alguien lo creó justo ahora.
  const raced = await visibleByPhone(session.access, typed.phone);
  if (raced) return { contact: raced, created: false };
  throw new NewNumberError("forbidden_contact", GENERICO, 422);
}

/** Registra si hace falta y abre (o crea, vacía) la conversación del contacto. */
export async function openChat(
  session: Who,
  phone: string
): Promise<{ contact: ContactRow; conversationId: string; created: boolean }> {
  await assertOrgActive(session.organizationId);
  const { contact, created } = await registerContact(session, { phone });
  const conversation = await getOrCreateConversation(session.organizationId, contact.id);
  return { contact, conversationId: conversation.id, created };
}

export type ConsentAnswer = "yes" | "unknown";

export const NEW_NUMBER_CONSENT_SOURCE = "declarado al escribir desde la Bandeja";

/**
 * Escribirle PRIMERO a alguien solo puede ser una plantilla aprobada, y solo
 * a quien aceptó recibir mensajes de la empresa. La regla es la de las
 * campañas (`opt_in`), aplicada aquí en el servidor:
 *
 * - ya `opt_in`: pasa.
 * - `desconocido`: hay que DECLARAR que aceptó («Sí»). «No lo sé» no envía.
 * - `opt_out` (pidió la baja): no se envía, salvo que quien lo hace tenga
 *   `contacts.consent_override` y declare «Sí»; queda en la línea de tiempo.
 *
 * Todo lo demás (plantilla aprobada, activa, sandbox, organización activa,
 * variables) lo valida `sendTemplate`.
 */
export async function sendFirstTemplate(
  session: Who,
  input: {
    phone: string;
    templateId: string;
    variables?: string[];
    consent: ConsentAnswer;
  }
): Promise<{ contact: ContactRow; conversationId: string; messageId: string }> {
  await assertOrgActive(session.organizationId);
  const typed = normalizeTypedPhone(input.phone);
  if (!typed.valid) {
    throw new NewNumberError("invalid_phone", typed.problem ?? "Teléfono no válido", 422);
  }

  // Revisa el consentimiento ANTES de crear nada: sin él no se registra ni el
  // contacto desde aquí (para registrar sin enviar está «Registrar contacto»).
  const existing = await visibleByPhone(session.access, typed.phone);
  if (existing?.waConsent === "opt_out" && !can(session, "contacts.consent_override")) {
    throw new NewNumberError(
      "opted_out",
      "Esta persona pidió no recibir mensajes. Solo el Propietario o un Coordinador puede cambiarlo",
      403
    );
  }
  const alreadyIn = existing?.waConsent === "opt_in";
  if (!alreadyIn && input.consent !== "yes") {
    throw new NewNumberError(
      "consent_required",
      "Para escribirle primero tiene que haber aceptado recibir mensajes de tu negocio",
      403
    );
  }

  const { contact } = await registerContact(session, { phone: typed.phone });
  // Defensa por si el contacto cambió entre las dos lecturas.
  if (contact.waConsent === "opt_out" && !can(session, "contacts.consent_override")) {
    throw new NewNumberError("opted_out", "Esta persona pidió no recibir mensajes", 403);
  }
  if (contact.waConsent !== "opt_in") {
    const now = new Date();
    await getDb().transaction(async (tx) => {
      await tx
        .update(schema.contact)
        .set({
          waConsent: "opt_in",
          waConsentSource: NEW_NUMBER_CONSENT_SOURCE,
          waConsentAt: now,
          updatedAt: now,
        })
        .where(
          scoped(schema.contact.organizationId, session.organizationId, eq(schema.contact.id, contact.id))
        );
      await logActivity(
        {
          organizationId: session.organizationId,
          contactId: contact.id,
          kind: "consent_changed",
          actorUserId: session.userId,
          source: "usuario",
          detail: { from: contact.waConsent, to: "opt_in", source: NEW_NUMBER_CONSENT_SOURCE },
          occurredAt: now,
        },
        tx
      );
    });
  }

  const conversation = await getOrCreateConversation(session.organizationId, contact.id);
  const { messageId } = await sendTemplate({
    organizationId: session.organizationId,
    conversationId: conversation.id,
    templateId: input.templateId,
    variables: input.variables,
  });
  const fresh = (await getContactById(session.access, contact.id)) ?? contact;
  return { contact: fresh, conversationId: conversation.id, messageId };
}
