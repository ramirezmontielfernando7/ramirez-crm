import { graphRequest, MetaApiError } from "@/lib/meta/client";
import { logger } from "@/lib/log";

const log = logger("connect");

export type ConnectionCheck =
  | {
      ok: true;
      displayPhoneNumber: string;
      verifiedName: string | null;
    }
  | { ok: false; code: "invalid_token" | "meta_unavailable" | "meta_error"; message: string };

/**
 * Valida token↔número contra la Graph API SIN persistir nada (FR-040):
 * un GET del número con el token debe devolver su display_phone_number.
 */
export async function testConnection(
  phoneNumberId: string,
  token: string
): Promise<ConnectionCheck> {
  try {
    const res = await graphRequest<{
      display_phone_number?: string;
      verified_name?: string;
      id: string;
    }>(`${phoneNumberId}?fields=display_phone_number,verified_name`, {
      token,
    });
    if (!res.display_phone_number) {
      return {
        ok: false,
        code: "meta_error",
        message:
          "Meta no devolvió el número: verifica que el Phone Number ID sea correcto",
      };
    }
    return {
      ok: true,
      displayPhoneNumber: res.display_phone_number,
      verifiedName: res.verified_name ?? null,
    };
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        return {
          ok: false,
          code: "invalid_token",
          message:
            "El token no es válido o expiró. Verifica que corresponde a este número (modo directo: token de usuario del sistema; modo agencia: token entregado por tu backend).",
        };
      }
      if (err.status === 0 || err.status >= 500) {
        return {
          ok: false,
          code: "meta_unavailable",
          message: "Meta no está disponible en este momento; intenta de nuevo",
        };
      }
      return { ok: false, code: "meta_error", message: err.message };
    }
    throw err;
  }
}

/** Respuesta de `GET {WABA}/subscribed_apps`: una entrada por app suscrita. */
type SubscribedApps = {
  data?: {
    whatsapp_business_api_data?: { id?: string; name?: string; link?: string };
    override_callback_uri?: string;
  }[];
};

export type SubscribeOutcome = "subscribed" | "override_kept" | "failed";

/**
 * Suscribe la app a la WABA tras guardar (necesario para recibir webhooks en
 * modo directo), SIN pisar un override de callback.
 *
 * Un `POST {WABA}/subscribed_apps` sin cuerpo no es inocuo: es justo como Meta
 * documenta BORRAR el callback alterno de la WABA ("Delete WABA alternate
 * callback") — los webhooks vuelven al callback del panel de la app. Si la
 * WABA ya enruta a un override (el backend de una agencia, o un cerebro
 * externo como Nea que recibe los webhooks directo de Meta), re-suscribir en
 * cada "Guardar" —o al rotar el token— lo desconectaba en silencio. Por eso
 * primero se consulta y, si alguna app tiene override, se respeta.
 *
 * Best-effort de punta a punta: si la consulta falla se suscribe como antes, y
 * si la suscripción falla se registra y sigue. Jamás lanza.
 */
export async function subscribeAppToWaba(
  wabaId: string,
  token: string
): Promise<SubscribeOutcome> {
  try {
    const res = await graphRequest<SubscribedApps | null>(
      `${wabaId}/subscribed_apps`,
      { token }
    );
    const override = (Array.isArray(res?.data) ? res.data : [])
      .map((app) => app?.override_callback_uri)
      .find(
        (uri): uri is string => typeof uri === "string" && uri.trim() !== ""
      );
    if (override) {
      // Solo el host: la ruta de un webhook suele llevar un segmento secreto
      // (el de Vocero es /api/webhooks/wa/<verify token>).
      log.info("la WABA enruta sus webhooks a un override: se respeta y no se re-suscribe la app", {
        waba: wabaId,
        overrideHost: hostOf(override),
      });
      return "override_kept";
    }
  } catch (err) {
    log.warn("no se pudo consultar subscribed_apps; se suscribe igual (best-effort)", { waba: wabaId, err });
  }

  try {
    await graphRequest(`${wabaId}/subscribed_apps`, {
      method: "POST",
      token,
    });
    return "subscribed";
  } catch (err) {
    log.warn("subscribed_apps falló (esperado en modo agencia)", { waba: wabaId, err });
    return "failed";
  }
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).host || "host desconocido";
  } catch {
    return "URL no válida";
  }
}
