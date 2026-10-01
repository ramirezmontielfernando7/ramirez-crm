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

export type WabaCheck =
  | { ok: true }
  | {
      ok: false;
      code: "phone_not_in_waba" | "waba_not_accessible" | "missing_permission" | "invalid_token" | "meta_unavailable" | "meta_error";
      message: string;
    };

type PhoneNumbersPage = {
  data?: { id?: string }[];
  paging?: { cursors?: { after?: string }; next?: string };
};

/** Más que suficiente: una WABA tiene unos pocos números. */
const MAX_PAGES = 10;

/**
 * H25 — El número declarado pertenece a la WABA declarada. Sin esto, se podía
 * guardar un número con la WABA de OTRO negocio, y los eventos de plantillas
 * de esa WABA terminaban en la organización equivocada.
 *
 * `GET {WABA}/phone_numbers` (paginado) con el MISMO token: requiere el
 * permiso whatsapp_business_management, que el token de un usuario del
 * sistema para la Cloud API normalmente tiene. Solo se pide al GUARDAR: una
 * conexión ya guardada no se vuelve a validar.
 */
export async function verifyPhoneInWaba(
  wabaId: string,
  phoneNumberId: string,
  token: string
): Promise<WabaCheck> {
  let after: string | undefined;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = `fields=id&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const res = await graphRequest<PhoneNumbersPage | null>(`${wabaId}/phone_numbers?${query}`, { token });
      const ids = (Array.isArray(res?.data) ? res.data : []).map((n) => n?.id);
      if (ids.includes(phoneNumberId)) return { ok: true };
      after = res?.paging?.next ? res.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return {
      ok: false,
      code: "phone_not_in_waba",
      message: `El Phone Number ID ${phoneNumberId} no pertenece a la WABA ${wabaId}. Revisa los dos en el Administrador de WhatsApp (WhatsApp Manager → Números de teléfono).`,
    };
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        return { ok: false, code: "invalid_token", message: "El token no es válido o expiró." };
      }
      if (err.status === 0 || err.status >= 500) {
        return { ok: false, code: "meta_unavailable", message: "Meta no está disponible en este momento; intenta de nuevo" };
      }
      if (err.code === 10 || err.code === 200) {
        return {
          ok: false,
          code: "missing_permission",
          message:
            "El token no puede leer los números de esa WABA: necesita el permiso whatsapp_business_management (en el usuario del sistema, asígnale la WABA con control total y genera el token con ese permiso).",
        };
      }
      if (err.code === 100) {
        return {
          ok: false,
          code: "waba_not_accessible",
          message: `La WABA ${wabaId} no existe o el token no tiene acceso a ella. Revisa el WhatsApp Business Account ID.`,
        };
      }
      log.warn("no se pudo validar el número contra la WABA", { waba: wabaId, status: err.status, code: err.code });
      return { ok: false, code: "meta_error", message: "Meta rechazó la validación del número contra la WABA; revisa los IDs" };
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
