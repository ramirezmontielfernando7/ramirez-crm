import { whatsappOwnedElsewhere } from "@/server/credentials/resolve";
import { saveCredentials } from "@/server/whatsapp/credentials";
import { subscribeAppToWaba, testConnection, verifyPhoneInWaba, type SubscribeOutcome } from "@/server/whatsapp/connect";

/**
 * El camino COMÚN para dejar conectado un número, venga de la conexión
 * manual (se pegan IDs y token) o de «Conectar con Facebook» (Tech Provider:
 * el token sale del código de Meta). Mismas validaciones, mismo guardado.
 */

/** Espera antes de reintentar la suscripción (Meta a veces tarda en reconocer el token nuevo). */
const SUBSCRIBE_RETRY_MS = process.env.NODE_ENV === "test" ? 0 : 1500;

type ConnectionFailure = { ok: false; status: number; code: string; message: string };

type ValidConnection = { ok: true; displayPhoneNumber: string; verifiedName: string | null };

/** Token↔número, número↔WABA y que no sea de otra organización. Sin escribir nada. */
export async function validateConnection(
  organizationId: string,
  wabaId: string,
  phoneNumberId: string,
  token: string
): Promise<ValidConnection | ConnectionFailure> {
  const check = await testConnection(phoneNumberId, token);
  if (!check.ok) return fail(check.code === "meta_unavailable" ? 503 : 422, check.code, check.message);

  // H25: el número es de ESA WABA (con el mismo token).
  const inWaba = await verifyPhoneInWaba(wabaId, phoneNumberId, token);
  if (!inWaba.ok) return fail(inWaba.code === "meta_unavailable" ? 503 : 422, inWaba.code, inWaba.message);

  // H25: ¿ya lo tiene otra organización? Se pregunta DESPUÉS de que Meta
  // aceptó el token para ese número: solo quien lo controla llega aquí.
  const elsewhere = await whatsappOwnedElsewhere(organizationId, phoneNumberId, wabaId);
  if (elsewhere.phone || elsewhere.waba) return alreadyConnectedElsewhere(elsewhere.phone);

  return { ok: true, displayPhoneNumber: check.displayPhoneNumber, verifiedName: check.verifiedName };
}

/**
 * Guarda cifrado y suscribe la app a la WABA (respeta overrides).
 *
 * Auditoría DF-14: devuelve si la suscripción quedó (`webhook`), para que la
 * pantalla NO diga «conectado» cuando Meta no aceptó mandar los mensajes
 * nuevos. Guardar el acceso no es lo mismo que recibir mensajes. Si falla, se
 * reintenta una vez (nunca se toca un override).
 */
export async function storeConnection(input: {
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  token: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
}): Promise<{ ok: true; webhook: SubscribeOutcome } | ConnectionFailure> {
  try {
    await saveCredentials(input);
  } catch (err) {
    // Carrera: otra organización lo guardó entre la pregunta y el guardado.
    // El índice único (23505) o la FK de la WABA (23503) lo frenan.
    const code = pgCode(err);
    if (code === "23505" || code === "23503") return alreadyConnectedElsewhere(code === "23505");
    throw err;
  }

  // Best-effort: necesaria en modo directo. Si la WABA ya enruta a un override
  // (backend de agencia o cerebro externo), se respeta: re-suscribir lo borraría.
  let webhook = await subscribeAppToWaba(input.wabaId, input.token);
  if (webhook === "failed") {
    await new Promise((r) => setTimeout(r, SUBSCRIBE_RETRY_MS));
    webhook = await subscribeAppToWaba(input.wabaId, input.token);
  }
  return { ok: true, webhook };
}

function fail(status: number, code: string, message: string): ConnectionFailure {
  return { ok: false, status, code, message };
}

function alreadyConnectedElsewhere(phone: boolean): ConnectionFailure {
  return fail(
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
