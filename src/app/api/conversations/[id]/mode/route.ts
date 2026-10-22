import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { DIRECT_TEXT } from "@/lib/direct-connection";
import { publish } from "@/server/events/bus";
import { serializeConversation, getConversation } from "@/server/inbox/queries";
import { setChatMode } from "@/server/direct-connection/mode";
import { conexionDirectaOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * Conexión directa (PR 5) — Cambiar el modo de UN chat desde el punto de
 * color del avatar: Oficial (meta), Directa (directa) o Directa con «Recibir
 * por Meta» (mixta). Permiso `direct_connection.mode` (Propietario y
 * Coordinador; delegable). Sin el complemento: 404 (cero rastro). El chat que
 * la sesión no ve es un 404, como en el resto de la Bandeja.
 */
const bodySchema = z.object({ mode: z.enum(["meta", "directa", "mixta"]) }).strict();

type Params = { params: Promise<{ id: string }> };

export const PUT = withAuth(
  async (session, req: Request, ctx: Params) => {
    const off = await conexionDirectaOff(session.organizationId);
    if (off) return off;
    const { id } = await ctx.params;
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;

    if (!(await getConversation(session.access, id))) return apiError(404, "not_found", "Conversación no encontrada");

    const r = await setChatMode(session.organizationId, id, body.data.mode);
    if (!r.ok) {
      if (r.error === "not_found") return apiError(404, "not_found", "Conversación no encontrada");
      if (r.error === "paused") return apiError(409, "paused", DIRECT_TEXT.emergencyPause);
      if (r.error === "not_whatsapp") return apiError(422, "not_whatsapp", "Este chat no admite conexión directa.");
      return apiError(409, "no_device", "Vincula un dispositivo en Ajustes para usar la conexión directa.");
    }

    const row = await getConversation(session.access, id);
    if (!row) return Response.json({ conversation: null });
    const dto = serializeConversation(row.conversation, row.contact, null, null, row.anuncio, row.assigneeName, {
      campaignName: row.campaignName,
    });
    publish(session.organizationId, { type: "conversation.updated", data: { conversation: dto } });
    return Response.json({ conversation: dto });
  },
  { permission: "direct_connection.mode" }
);
