import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  getCredentialsByOrg,
  isValidPhoneNumberId,
  isValidWabaId,
  tokenLast4,
} from "@/server/whatsapp/credentials";
import { embeddedSignupConfig } from "@/server/whatsapp/embedded-signup";
import { storeConnection, validateConnection } from "@/server/whatsapp/save-connection";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const creds = await getCredentialsByOrg(session.organizationId);
  // Tech Provider: lo público que necesita el botón «Conectar con Facebook»
  // (null = la plataforma aún no lo configura; queda la conexión manual).
  const embeddedSignup = embeddedSignupConfig();
  if (!creds) return Response.json({ connection: null, embeddedSignup });
  return Response.json({
    embeddedSignup,
    connection: {
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
});

/** Guarda la conexión: re-valida contra Meta, cifra y suscribe (FR-040). */
export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const { wabaId, phoneNumberId, token } = body.data;

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
  });
  if (!stored.ok) return apiError(stored.status, stored.code, stored.message);

  return Response.json({
    ok: true,
    displayPhoneNumber: valid.displayPhoneNumber,
  });
}, { permission: "settings.manage" });
