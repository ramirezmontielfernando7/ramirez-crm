import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { TAG_COLORS } from "@/lib/tags";
import {
  getCredentialsByOrg,
  isValidPhoneNumberId,
  isValidWabaId,
  tokenLast4,
} from "@/server/whatsapp/credentials";
import { listWhatsAppNumbers } from "@/server/credentials";
import { embeddedSignupConfig } from "@/server/whatsapp/embedded-signup";
import { storeConnection, validateConnection } from "@/server/whatsapp/save-connection";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const creds = await getCredentialsByOrg(session.organizationId);
  // Tech Provider: lo público que necesita el botón «Conectar con Facebook»
  // (null = la plataforma aún no lo configura; queda la conexión manual).
  const embeddedSignup = embeddedSignupConfig();
  if (!creds) return Response.json({ connection: null, numbers: [], embeddedSignup });
  // 0080: `connection` sigue siendo el número principal; `numbers` trae todos.
  const numbers = await listWhatsAppNumbers(session.organizationId);
  return Response.json({
    embeddedSignup,
    numbers,
    connection: {
      label: creds.label,
      wabaId: creds.wabaId,
      phoneNumberId: creds.phoneNumberId,
      displayPhoneNumber: creds.displayPhoneNumber,
      verifiedName: creds.verifiedName,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
    },
  });
}, { permission: "settings.manage" });

const putSchema = z.object({
  wabaId: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1),
  token: z.string().trim().min(1),
  /** 0080: nombre del número («Ventas»); opcional. */
  label: z.string().trim().max(40).optional(),
  color: z.enum(TAG_COLORS).optional(),
});

/** Guarda la conexión: re-valida contra Meta, cifra y suscribe (FR-040). */
export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const { wabaId, phoneNumberId, token, label, color } = body.data;

  // H8: los IDs de Meta son solo dígitos. Un valor raro no llega a Meta ni a la BD.
  if (!isValidWabaId(wabaId)) {
    return apiError(422, "invalid_waba_id", "El WhatsApp Business Account ID son solo dígitos (WhatsApp Manager → Configuración de la cuenta)");
  }
  if (!isValidPhoneNumberId(phoneNumberId)) {
    return apiError(422, "invalid_phone_number_id", "El Phone Number ID son solo dígitos (WhatsApp Manager → Números de teléfono)");
  }

  const valid = await validateConnection(session.organizationId, wabaId, phoneNumberId, token);
  if (!valid.ok) return apiError(valid.status, valid.code, valid.message);

  const stored = await storeConnection({
    organizationId: session.organizationId,
    wabaId,
    phoneNumberId,
    token,
    displayPhoneNumber: valid.displayPhoneNumber,
    verifiedName: valid.verifiedName,
    label,
    color,
  });
  if (!stored.ok) return apiError(stored.status, stored.code, stored.message);

  return Response.json({
    ok: true,
    displayPhoneNumber: valid.displayPhoneNumber,
    // DF-14: ¿Meta aceptó mandar los mensajes nuevos? (o hay un override que se respetó)
    webhook: stored.webhook,
  });
}, { permission: "settings.manage" });
