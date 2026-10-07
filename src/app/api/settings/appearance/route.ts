import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { CHAT_STYLES, FONT_KEYS } from "@/lib/appearance";
import { saveOrgAppearance } from "@/server/appearance";

export const dynamic = "force-dynamic";

const putSchema = z
  .object({
    font: z.enum(FONT_KEYS).optional(),
    chatStyle: z.enum(CHAT_STYLES).optional(),
  })
  .refine((v) => v.font !== undefined || v.chatStyle !== undefined, "Nada que guardar");

/**
 * Fase D — La apariencia de TODA la organización (letra y estilo del chat).
 * Solo quien administra. Lo personal no pasa por aquí: vive en una cookie del
 * propio navegador.
 */
export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const appearance = await saveOrgAppearance(session.organizationId, body.data);
  return Response.json({ ok: true, appearance });
}, { permission: "settings.manage" });
