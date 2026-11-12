import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  FORGOTTEN_HOURS_OPTIONS,
  MAX_AUTO_TEXT_LENGTH,
  parseAutoHours,
  validateAutoHours,
  WEEKDAYS,
} from "@/lib/auto-replies";
import { isValidTimeZone } from "@/lib/time/slots";
import {
  DEFAULT_AUTO_REPLY_SETTINGS,
  getAutoReplySettings,
  saveAutoReplySettings,
} from "@/server/auto-replies/settings";

export const dynamic = "force-dynamic";

/** 049 — Mensajes automáticos (bienvenida, fuera de horario) y aviso de chats olvidados. */
export const GET = withAuth(async (session) => {
  const settings = await getAutoReplySettings(session.organizationId);
  return Response.json({ settings, defaults: DEFAULT_AUTO_REPLY_SETTINGS });
}, { permission: "settings.manage" });

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const day = z.object({ open: z.boolean(), from: hhmm, to: hhmm });

const putSchema = z.object({
  welcomeEnabled: z.boolean(),
  welcomeText: z.string().trim().max(MAX_AUTO_TEXT_LENGTH).nullable(),
  awayEnabled: z.boolean(),
  awayText: z.string().trim().max(MAX_AUTO_TEXT_LENGTH).nullable(),
  hours: z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, day])) as Record<(typeof WEEKDAYS)[number], typeof day>),
  timezone: z.string().max(80),
  forgottenAlertHours: z
    .number()
    .int()
    .refine((n) => (FORGOTTEN_HOURS_OPTIONS as readonly number[]).includes(n), "Elige 1, 2, 4, 8 o 24 horas")
    .nullable(),
});

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const d = body.data;
  if (!isValidTimeZone(d.timezone)) return apiError(422, "invalid_timezone", "Esa zona horaria no existe");
  const hours = parseAutoHours(d.hours);
  const welcome = d.welcomeText?.trim() || null;
  const away = d.awayText?.trim() || null;
  if (d.welcomeEnabled && !welcome) return apiError(422, "invalid_welcome", "Escribe el mensaje de bienvenida o apágalo");
  if (d.awayEnabled && !away) return apiError(422, "invalid_away", "Escribe el mensaje de fuera de horario o apágalo");
  // El horario solo importa si algo lo usa (fuera de horario o el aviso de chats olvidados).
  if (d.awayEnabled) {
    const bad = validateAutoHours(hours);
    if (bad) return apiError(422, "invalid_hours", bad);
  }
  const settings = await saveAutoReplySettings(
    session.organizationId,
    {
      welcomeEnabled: d.welcomeEnabled,
      welcomeText: welcome,
      awayEnabled: d.awayEnabled,
      awayText: away,
      hours,
      timezone: d.timezone,
      forgottenAlertHours: d.forgottenAlertHours,
    },
    session.userId
  );
  return Response.json({ settings });
}, { permission: "settings.manage" });
