import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { DIRECT_TEXT } from "@/lib/direct-connection";
import { applyModeToAll, countWhatsAppChats } from "@/server/direct-connection/mode";
import { isOrgWithoutMeta } from "@/server/direct-connection/without-meta";
import { conexionDirectaOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * Conexión directa — «Aplicar a todos los chats» de Ajustes: el mismo modo
 * (Meta, Conexión directa o Conexión híbrida) en todos los chats de WhatsApp
 * de una vez. Permiso `direct_connection.mode` y, como toca chats de todos,
 * solo quien ve todos los chats. Sin el complemento: 404 (cero rastro). Sin
 * Meta no hay nada que elegir: 422.
 */
export const GET = withAuth(
  async (session) => {
    const off = await conexionDirectaOff(session.organizationId);
    if (off) return off;
    if (!session.access.seesAll) return apiError(403, "forbidden", "Solo quien ve todos los chats puede cambiarlos todos.");
    return Response.json({ chats: await countWhatsAppChats(session.organizationId) });
  },
  { permission: "direct_connection.mode" }
);

const bodySchema = z.object({ mode: z.enum(["meta", "directa", "mixta"]) }).strict();

export const POST = withAuth(
  async (session, req: Request) => {
    const off = await conexionDirectaOff(session.organizationId);
    if (off) return off;
    if (!session.access.seesAll) return apiError(403, "forbidden", "Solo quien ve todos los chats puede cambiarlos todos.");
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;
    if (await isOrgWithoutMeta(session.organizationId)) {
      return apiError(422, "metaless", DIRECT_TEXT.metalessNote);
    }
    const r = await applyModeToAll(session.organizationId, body.data.mode);
    if (!r.ok) {
      if (r.error === "paused") return apiError(409, "paused", DIRECT_TEXT.emergencyPause);
      return apiError(409, "no_device", "Vincula un dispositivo en Ajustes para usar la conexión directa.");
    }
    return Response.json({ mode: r.mode, changed: r.changed });
  },
  { permission: "direct_connection.mode" }
);
