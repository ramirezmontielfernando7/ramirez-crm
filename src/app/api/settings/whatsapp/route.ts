import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  getCredentialsByOrg,
  isValidPhoneNumberId,
  isValidWabaId,
  saveCredentials,
  tokenLast4,
} from "@/server/whatsapp/credentials";
import {
  subscribeAppToWaba,
  testConnection,
  verifyPhoneInWaba,
} from "@/server/whatsapp/connect";
import { whatsappOwnedElsewhere } from "@/server/credentials/resolve";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const creds = await getCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
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

  const check = await testConnection(phoneNumberId, token);
  if (!check.ok) {
    const status = check.code === "meta_unavailable" ? 503 : 422;
    return apiError(status, check.code, check.message);
  }

  // H25: el número es de ESA WABA (con el mismo token).
  const inWaba = await verifyPhoneInWaba(wabaId, phoneNumberId, token);
  if (!inWaba.ok) {
    const status = inWaba.code === "meta_unavailable" ? 503 : 422;
    return apiError(status, inWaba.code, inWaba.message);
  }

  // H25: ¿ya lo tiene otra organización? Se pregunta DESPUÉS de que Meta
  // aceptó el token para ese número: solo quien lo controla llega aquí.
  const elsewhere = await whatsappOwnedElsewhere(session.organizationId, phoneNumberId, wabaId);
  if (elsewhere.phone || elsewhere.waba) return alreadyConnectedElsewhere(elsewhere.phone);

  try {
    await saveCredentials({
      organizationId: session.organizationId,
      wabaId,
      phoneNumberId,
      token,
      displayPhoneNumber: check.displayPhoneNumber,
      verifiedName: check.verifiedName,
    });
  } catch (err) {
    // Carrera: otra organización lo guardó entre la pregunta y el guardado.
    // El índice único (23505) o la FK de la WABA (23503) lo frenan.
    const code = pgCode(err);
    if (code === "23505" || code === "23503") return alreadyConnectedElsewhere(code === "23505");
    throw err;
  }

  // Best-effort: necesaria en modo directo. Si la WABA ya enruta a un override
  // (backend de agencia o cerebro externo), se respeta: re-suscribir lo borraría.
  await subscribeAppToWaba(wabaId, token);

  return Response.json({
    ok: true,
    displayPhoneNumber: check.displayPhoneNumber,
  });
}, { permission: "settings.manage" });

function alreadyConnectedElsewhere(phone: boolean): Response {
  return apiError(
    409,
    phone ? "phone_in_use" : "waba_in_use",
    phone
      ? "Ese número ya está conectado a otro negocio en esta plataforma. Si es tuyo, pide que lo desconecten allá primero."
      : "Esa WABA ya está conectada a otro negocio en esta plataforma. Si es tuya, pide que la desconecten allá primero."
  );
}

/** Código SQLSTATE de un error de postgres-js (envuelto o no por drizzle). */
function pgCode(err: unknown): string | null {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return null;
}
