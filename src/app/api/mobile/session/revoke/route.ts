import { getAuth } from "@/lib/auth";
import { isBrowserRequest, mobileBearerHeaders } from "@/lib/auth/mobile";

export const dynamic = "force-dynamic";

function reply(data: object, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  if (isBrowserRequest(req.headers) || req.headers.has("cookie")) {
    return reply({ code: "FORBIDDEN", message: "Usa la aplicación móvil." }, 403);
  }
  const headers = await mobileBearerHeaders(req.headers);
  const auth = getAuth();
  const query = { disableRefresh: true };
  if (!headers || !(await auth.api.getSession({ headers, query }))) {
    return reply({ code: "UNAUTHORIZED", message: "No autenticado" }, 401);
  }

  const result = await auth.api.signOut({ headers, asResponse: true });
  // signOut may recover from an adapter deletion error. Confirm that this
  // credential no longer resolves before reporting a successful revocation.
  if (!result.ok || await auth.api.getSession({ headers, query })) {
    return reply({ code: "REVOCATION_FAILED", message: "No se pudo cerrar la sesión." }, 503);
  }
  return reply({ success: true });
}
