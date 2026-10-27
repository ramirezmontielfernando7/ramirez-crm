import { apiError } from "@/lib/api";
import { DIRECT_TEXT } from "@/lib/direct-connection";
import { MiNumeroFailure, type MiNumeroError } from "./numbers";

/** Mi número (046) — lo que dice la API ante cada error, en palabras de la persona. */
const MESSAGE: Record<MiNumeroError, [number, string]> = {
  not_member: [422, "Esa persona no es parte de tu equipo."],
  has_number: [409, "Esa persona ya tiene su número autorizado."],
  limit_reached: [
    409,
    "Ya usas todos los números de tu plan. Pide más a soporte.",
  ],
  not_found: [404, "No encontramos ese número."],
  owner_must_accept: [
    409,
    "Solo la persona puede aceptar que su número pase a ser de la empresa.",
  ],
  owner_only: [
    403,
    "Los ajustes de un número personal solo los cambia su dueño.",
  ],
  company_decides: [
    403,
    "Este número es de la empresa: sus ajustes los decide el Coordinador o el Propietario.",
  ],
  notice_required: [409, "Antes de vincular, lee y acepta el aviso."],
  bad_phone: [422, "Ese teléfono no parece válido. Revisa los dígitos."],
  requests_off: [409, "Esa persona no recibe solicitudes para ver sus chats."],
  not_linked: [409, "Tu número no está conectado. Vuelve a escanear el código en Ajustes → Mi número."],
  ai_off: [409, "La IA solo contesta chats de cliente, con «La IA contesta mis chats» encendido en Ajustes → Mi número."],
  share_off: [409, "Para marcar clientes, enciende «Compartir mis clientes con la empresa» en tu «Mi número»."],
  no_server: [
    503,
    "Aún no hay lugar para vincular tu número. Avisa a soporte.",
  ],
  server_unreachable: [
    503,
    "No pudimos comunicarnos para vincular. Intenta de nuevo en un momento.",
  ],
  server_key_unreadable: [
    503,
    "No pudimos comunicarnos para vincular. Avisa a soporte.",
  ],
  paused: [409, DIRECT_TEXT.emergencyPause],
  failed: [502, "No se pudo completar la acción. Intenta de nuevo."],
};

export function miNumeroError(code: MiNumeroError): Response {
  const [status, message] = MESSAGE[code];
  return apiError(status, code, message);
}

/** Corre `fn`; un `MiNumeroFailure` se vuelve su respuesta. Lo demás sigue hacia `withAuth`. */
export async function answer(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MiNumeroFailure) return miNumeroError(err.code);
    throw err;
  }
}
