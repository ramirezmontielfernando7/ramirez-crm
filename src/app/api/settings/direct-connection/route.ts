import { apiError, withAuth } from "@/lib/api";
import { DIRECT_TEXT } from "@/lib/direct-connection";
import { conexionDirectaOff } from "@/server/modules";
import { startLink, statusFor, unlink, type LinkError } from "@/server/direct-connection/link";

export const dynamic = "force-dynamic";

/**
 * Conexión directa (PR 2) — Vincular el dispositivo por QR desde Ajustes.
 * Sin el complemento: 404 (cero rastro). Con él: el Propietario, o quien él
 * delegue (`direct_connection.link`). Nunca devuelve el servidor ni su llave.
 */

const MESSAGE: Record<LinkError, [number, string]> = {
  no_server: [503, "La conexión directa aún no está disponible para tu negocio. Avisa a soporte."],
  server_unreachable: [503, "No pudimos comunicarnos para vincular. Intenta de nuevo en un momento."],
  server_key_unreadable: [503, "No pudimos comunicarnos para vincular. Avisa a soporte."],
  paused: [409, DIRECT_TEXT.emergencyPause],
  failed: [502, "No se pudo completar la acción. Intenta de nuevo."],
};

function failure(error: LinkError): Response {
  const [status, message] = MESSAGE[error];
  return apiError(status, error, message);
}

export const GET = withAuth(
  async (session) => {
    const off = await conexionDirectaOff(session.organizationId);
    if (off) return off;
    return Response.json({ connection: await statusFor(session.organizationId) });
  },
  { permission: "direct_connection.link" }
);

/** Vincular o reconectar: devuelve el QR (o «connected» si ya está vinculado). */
export const POST = withAuth(
  async (session) => {
    const off = await conexionDirectaOff(session.organizationId);
    if (off) return off;
    const r = await startLink(session.organizationId);
    if (!r.ok) return failure(r.error);
    return Response.json({ status: r.status, qr: r.qr });
  },
  { permission: "direct_connection.link" }
);

/** Desvincular el dispositivo. */
export const DELETE = withAuth(
  async (session) => {
    const off = await conexionDirectaOff(session.organizationId);
    if (off) return off;
    const r = await unlink(session.organizationId);
    if (!r.ok) return failure(r.error);
    return new Response(null, { status: 204 });
  },
  { permission: "direct_connection.link" }
);
