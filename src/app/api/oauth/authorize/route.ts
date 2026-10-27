import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { SCOPES } from "@/lib/ai-connector";
import {
  approveAuthorization,
  authorizeSchema,
  checkAuthorizeRequest,
  denyRedirect,
  requestedScopes,
} from "@/server/ai-connector/oauth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  params: authorizeSchema,
  decision: z.enum(["approve", "deny"]),
  scopes: z.array(z.enum(SCOPES)).max(2).default(["read"]),
});

/**
 * 047 PR 3 — La persona respondió en la pantalla «X quiere actuar como tú»
 * (`/oauth/authorize`). Devuelve la URL de regreso a la app: con el código
 * si aceptó, con `access_denied` si no. Cada quien conecta SU IA: la
 * conexión nace a nombre de quien tiene la sesión.
 */
export const POST = withAuth(async (session, req: Request) => {
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  const { params, decision, scopes } = parsed.data;
  const check = await checkAuthorizeRequest(params);
  if (!check.ok) return apiError(422, `invalid_${check.reason}`, "La solicitud de la app no es válida");
  if (decision === "deny") return Response.json({ redirect: denyRedirect(params) });
  // Nunca más de lo que pidió la app.
  const asked = requestedScopes(params);
  const granted = (scopes ?? ["read"]).filter((s) => asked.includes(s));
  const redirect = await approveAuthorization(session, params, check.client, granted);
  if (!redirect) return apiError(403, "connector_off", "El conector de IA está apagado para tu rol o tu organización");
  return Response.json({ redirect });
});
