import { getEnv } from "@/lib/env";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import { logger } from "@/lib/log";

const log = logger("embedded-signup");

/**
 * Tech Provider, PR 1 — «Conectar con Facebook» (Embedded Signup v4).
 *
 * El navegador corre el flujo de Meta y nos entrega tres cosas: un CÓDIGO de
 * un solo uso (vence a los 30 s), el `waba_id` y el `phone_number_id`. Aquí
 * el servidor cambia el código por el token de negocio del cliente (un token
 * con alcance solo a SUS activos, sin vencimiento) y, si el número es nuevo,
 * lo registra en la Cloud API. Lo demás (validar, guardar cifrado, suscribir
 * la app) es el mismo camino que la conexión manual.
 */

export type EmbeddedSignupConfig = {
  appId: string;
  configId: string;
  graphApiVersion: string;
};

/**
 * Lo que el navegador necesita para abrir el flujo. Todo es público (el App
 * ID y el ID de configuración viajan igual en la página de Meta). Null si
 * falta algo: la pantalla solo ofrece la conexión manual.
 */
export function embeddedSignupConfig(): EmbeddedSignupConfig | null {
  const env = getEnv();
  if (!env.META_APP_ID || !env.META_EMBEDDED_SIGNUP_CONFIG_ID || !appSecret()) return null;
  return {
    appId: env.META_APP_ID,
    configId: env.META_EMBEDDED_SIGNUP_CONFIG_ID,
    graphApiVersion: env.META_GRAPH_API_VERSION,
  };
}

function appSecret(): string | null {
  const secret = getEnv().META_APP_SECRET?.trim();
  return secret && !secret.startsWith("REEMPLAZA") ? secret : null;
}

export type ExchangeResult =
  | { ok: true; token: string }
  | { ok: false; code: "not_configured" | "code_expired" | "meta_unavailable" | "meta_error"; message: string };

/**
 * `GET oauth/access_token?client_id&client_secret&code` → token de negocio.
 * Se autentica con el token de APP (`app_id|app_secret`), así que no hace
 * falta ningún token del cliente. El secreto jamás sale en logs ni errores.
 */
export async function exchangeCodeForToken(code: string): Promise<ExchangeResult> {
  const config = embeddedSignupConfig();
  const secret = appSecret();
  if (!config || !secret) {
    return {
      ok: false,
      code: "not_configured",
      message: "«Conectar con Facebook» todavía no está configurado en esta plataforma; usa la conexión manual.",
    };
  }
  const query = new URLSearchParams({ client_id: config.appId, client_secret: secret, code });
  try {
    const res = await graphRequest<{ access_token?: unknown } | null>(`oauth/access_token?${query}`, {
      token: `${config.appId}|${secret}`,
    });
    const token = typeof res?.access_token === "string" ? res.access_token.trim() : "";
    if (!token) {
      return { ok: false, code: "meta_error", message: "Meta no devolvió el acceso a la cuenta; intenta conectar de nuevo." };
    }
    return { ok: true, token };
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.status === 0 || err.status >= 500) {
        return { ok: false, code: "meta_unavailable", message: "Meta no está disponible en este momento; intenta de nuevo." };
      }
      // Código vencido (30 s), ya usado o de otra app: Meta responde 400/100.
      log.warn("Meta rechazó el código de Embedded Signup", { status: err.status, code: err.code });
      return {
        ok: false,
        code: "code_expired",
        message: "La autorización de Facebook venció o ya se usó. Vuelve a dar clic en «Conectar con Facebook».",
      };
    }
    throw err;
  }
}

export type RegisterResult =
  | { ok: true }
  | { ok: false; code: "pin_mismatch" | "meta_unavailable" | "meta_error"; message: string };

/**
 * Número NUEVO: `POST {phone_number_id}/register` con el PIN de verificación
 * en dos pasos que eligió el cliente. Un número que ya usa la app de WhatsApp
 * Business en el celular (coexistencia) ya está registrado: no se llama.
 */
export async function registerPhoneNumber(phoneNumberId: string, token: string, pin: string): Promise<RegisterResult> {
  try {
    await graphRequest(`${phoneNumberId}/register`, {
      method: "POST",
      token,
      body: { messaging_product: "whatsapp", pin },
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.status === 0 || err.status >= 500) {
        return { ok: false, code: "meta_unavailable", message: "Meta no está disponible en este momento; intenta de nuevo." };
      }
      // 133005: el número ya tiene otro PIN de verificación en dos pasos.
      if (err.code === 133005) {
        return {
          ok: false,
          code: "pin_mismatch",
          message: "Ese número ya tiene un PIN de verificación en dos pasos distinto. Escribe ese PIN o cámbialo en el Administrador de WhatsApp.",
        };
      }
      log.warn("Meta no registró el número", { phone: phoneNumberId, status: err.status, code: err.code });
      return { ok: false, code: "meta_error", message: "Meta no pudo activar el número para la API; intenta de nuevo en unos minutos." };
    }
    throw err;
  }
}
