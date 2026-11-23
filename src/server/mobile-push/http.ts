import { z } from "zod";
import { apiError } from "@/lib/api";
import { mobileBearerHeaders } from "@/lib/auth/mobile";
import type { SessionContext } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { registerPushDevice, unregisterPushDevice } from "./devices";
import { mobilePushProvider } from "./fcm";

const bodySchema = z.object({ token: z.string().min(16).max(4096).regex(/^[A-Za-z0-9:_.-]+$/) }).strict();

export async function mobilePushRegistration(session: SessionContext, req: Request, register: boolean) {
  if (!session.sessionId || req.headers.has("cookie") || !(await mobileBearerHeaders(req.headers)))
    return apiError(401, "unauthorized", "Usa una sesión móvil.");
  if (register && !mobilePushProvider())
    return apiError(503, "push_unavailable", "Las notificaciones push no están disponibles.");
  const rawLength = req.headers.get("content-length");
  if (rawLength && Number(rawLength) > 8192)
    return apiError(413, "too_large", "Solicitud demasiado grande.");
  // Bound actual bytes, including requests without Content-Length.
  const reader = req.body?.getReader();
  if (!reader) return apiError(422, "invalid_body", "Falta el token del dispositivo.");
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 8192) return apiError(413, "too_large", "Solicitud demasiado grande.");
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return apiError(422, "invalid_body", "Token inválido.");
  } finally {
    void reader.cancel().catch(() => {});
  }
  // Avoid Zod messages/logs carrying input or database exceptions with parameters.
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return apiError(422, "invalid_body", "Token inválido."); }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return apiError(422, "invalid_body", "Token inválido.");
  if (!checkRateLimit(`mobile-push:${session.userId}`, { windowMs: 60_000, max: 30 }).allowed)
    return apiError(429, "rate_limited", "Demasiadas solicitudes.");
  try {
    const scope = { organizationId: session.organizationId, userId: session.userId, sessionId: session.sessionId };
    if (register) {
      if (!(await registerPushDevice(scope, body.data.token)))
        return apiError(409, "push_conflict", "No se pudo asociar este dispositivo a la sesión.");
    } else await unregisterPushDevice(scope, body.data.token);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return apiError(503, "push_unavailable", "No se pudo actualizar el dispositivo.");
  }
}
