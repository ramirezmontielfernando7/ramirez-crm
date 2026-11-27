import { APIError } from "better-auth/api";
import { z } from "zod";
import { parseBody } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { isBrowserRequest, signedSessionHeaders, signedTokenFromResponse } from "@/lib/auth/mobile";

export const dynamic = "force-dynamic";

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(1),
}).strict();

function reply(data: object, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  if (isBrowserRequest(req.headers) || req.headers.has("cookie")) {
    return reply({ code: "FORBIDDEN", message: "Usa la aplicación móvil." }, 403);
  }
  const body = await parseBody(req, credentials);
  if (!body.ok) {
    return reply({ code: "INVALID_BODY", message: "Ingresa tu correo y contraseña." }, 422);
  }

  const auth = getAuth();
  let result: Response;
  try {
    result = await auth.api.signInEmail({
      body: body.data,
      headers: req.headers,
      asResponse: true,
    });
  } catch (error) {
    // The direct API can throw a before-hook error even with asResponse.
    if (!(error instanceof APIError)) throw error;
    return reply({ code: error.body?.code, message: error.body?.message }, error.statusCode);
  }
  if (!result.ok) {
    // Better Auth already serialized the API error. Rebuild the response headers
    // so neither success nor failure can set cookies on the mobile client.
    const error: { code?: string; message?: string } = await result.json();
    return reply({ code: error.code, message: error.message }, result.status);
  }

  const { name } = (await auth.$context).authCookies.sessionToken;
  const token = signedTokenFromResponse(result, name);
  if (token) {
    const session = await auth.api.getSession({
      headers: signedSessionHeaders(name, token),
      query: { disableRefresh: true },
    });
    if (session) return reply({ token, expiresAt: session.session.expiresAt });
  }
  return reply({ code: "SESSION_UNAVAILABLE", message: "No se pudo abrir la sesión." }, 500);
}
