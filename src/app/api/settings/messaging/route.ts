import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { cleanStopKeywords, MAX_STOP_REPLY_LENGTH } from "@/lib/opt-out";
import {
  DEFAULT_MESSAGING_SETTINGS,
  getMessagingSettings,
  saveMessagingSettings,
} from "@/server/messaging-settings";

export const dynamic = "force-dynamic";

/** Campañas v2 (PR 1) — Ajustes de mensajería: bajas por palabra clave y alerta de uso. */
export const GET = withAuth(async (session) => {
  const settings = await getMessagingSettings(session.organizationId);
  return Response.json({ settings, defaults: DEFAULT_MESSAGING_SETTINGS });
}, { permission: "settings.manage" });

const putSchema = z.object({
  stopKeywordsEnabled: z.boolean(),
  stopKeywords: z.array(z.string().max(200)).max(100),
  stopReplyEnabled: z.boolean(),
  stopReplyText: z.string().trim().max(MAX_STOP_REPLY_LENGTH).nullable(),
  usageAlertPercent: z.number().int().min(1).max(100),
});

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const cleaned = cleanStopKeywords(body.data.stopKeywords);
  if ("error" in cleaned) return apiError(422, "invalid_keywords", cleaned.error);
  if (body.data.stopKeywordsEnabled && cleaned.keywords.length === 0) {
    return apiError(422, "invalid_keywords", "Agrega al menos una palabra de baja o apaga la función");
  }
  const reply = body.data.stopReplyText?.trim() || null;
  if (body.data.stopReplyEnabled && !reply) {
    return apiError(422, "invalid_reply", "Escribe el texto de la respuesta automática o apágala");
  }
  const settings = await saveMessagingSettings(
    session.organizationId,
    { ...body.data, stopKeywords: cleaned.keywords, stopReplyText: reply },
    session.userId
  );
  return Response.json({ settings });
}, { permission: "settings.manage" });
