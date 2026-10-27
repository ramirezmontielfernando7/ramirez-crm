import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isValidPhoneNumberId, isValidWabaId } from "@/server/whatsapp/credentials";
import { exchangeCodeForToken, registerPhoneNumber } from "@/server/whatsapp/embedded-signup";
import { storeConnection, validateConnection } from "@/server/whatsapp/save-connection";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  /** Código de un solo uso de `FB.login` (vence a los 30 s). */
  code: z.string().trim().min(1).max(4096),
  wabaId: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1),
  /**
   * `business_app`: el número ya usa la app de WhatsApp Business en el
   * celular (coexistencia; evento FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING) y
   * ya está registrado. `new_number`: número nuevo, hay que registrarlo.
   */
  flow: z.enum(["new_number", "business_app"]),
  /** PIN de verificación en dos pasos (6 dígitos); solo número nuevo. */
  pin: z.string().trim().regex(/^\d{6}$/).optional(),
});

/**
 * Tech Provider, PR 1 — Cierra «Conectar con Facebook»: cambia el código por
 * el token de negocio del cliente, registra el número si es nuevo y lo deja
 * conectado por el MISMO camino que la conexión manual.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;
  const { code, wabaId, phoneNumberId, flow, pin } = body.data;

  if (!isValidWabaId(wabaId) || !isValidPhoneNumberId(phoneNumberId)) {
    return apiError(422, "invalid_ids", "Meta devolvió datos de la cuenta que no se reconocen; vuelve a intentar la conexión");
  }
  if (flow === "new_number" && !pin) {
    return apiError(422, "pin_required", "Para un número nuevo elige un PIN de 6 dígitos (verificación en dos pasos)");
  }

  // Primero el código: vence a los 30 s, así que va antes que todo lo demás.
  const exchanged = await exchangeCodeForToken(code);
  if (!exchanged.ok) {
    const status = exchanged.code === "meta_unavailable" ? 503 : exchanged.code === "not_configured" ? 409 : 422;
    return apiError(status, exchanged.code, exchanged.message);
  }
  const token = exchanged.token;

  const valid = await validateConnection(session.organizationId, wabaId, phoneNumberId, token);
  if (!valid.ok) return apiError(valid.status, valid.code, valid.message);

  if (flow === "new_number" && pin) {
    const registered = await registerPhoneNumber(phoneNumberId, token, pin);
    if (!registered.ok) {
      return apiError(registered.code === "meta_unavailable" ? 503 : 422, registered.code, registered.message);
    }
  }

  const stored = await storeConnection({
    organizationId: session.organizationId,
    wabaId,
    phoneNumberId,
    token,
    displayPhoneNumber: valid.displayPhoneNumber,
    verifiedName: valid.verifiedName,
  });
  if (!stored.ok) return apiError(stored.status, stored.code, stored.message);

  return Response.json({ ok: true, displayPhoneNumber: valid.displayPhoneNumber, verifiedName: valid.verifiedName });
}, { permission: "settings.manage" });
