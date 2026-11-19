import { validateEnvironment, verifyIdentity } from "./policy.mjs";
const routes = new Map([
  ["POST /api/auth/sign-in/email", "login"],
  ["GET /api/auth/get-session", "session"],
  ["POST /api/auth/sign-out", "logout"],
]);
/** Request/Response factory ONLY: no listener, no startup script and no default live dependency. */
export function createAuthOnlyHandler(environment, dependencies) {
  const plan = validateEnvironment(environment);
  if (
    typeof dependencies?.identities !== "function" ||
    typeof dependencies?.loadAuth !== "function"
  )
    throw Error("missing-reviewed-adapters");
  return async function handle(request) {
    const reject = (code, status) =>
      Response.json(
        { error: { code } },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    try {
      const url = new URL(request.url);
      if (
        url.origin !== plan.origin ||
        url.search ||
        url.hash ||
        url.pathname.includes("%") ||
        !routes.has(request.method + " " + url.pathname)
      )
        return reject("route-unavailable", 404);
      const origin = request.headers.get("Origin");
      if (
        (request.method === "POST" && origin !== plan.origin) ||
        (origin && origin !== plan.origin)
      )
        return reject("origin", 403);
      if (
        request.method === "POST" &&
        !request.headers
          .get("Content-Type")
          ?.toLowerCase()
          .startsWith("application/json")
      )
        return reject("content-type", 415);
      let forwarded = request;
      if (request.body) {
        const reader = request.body.getReader();
        let size = 0;
        const chunks = [];
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8192) {
            await reader.cancel();
            return reject("body-size", 413);
          }
          chunks.push(value);
        }
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        forwarded = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body,
          duplex: "half",
        });
      }
      const [app, system] = await dependencies.identities();
      verifyIdentity(plan, app, system);
      const auth = await dependencies.loadAuth();
      const result = await auth.handler(forwarded);
      result.headers.set("Cache-Control", "no-store");
      return result;
    } catch {
      return reject("auth-test-unavailable", 503);
    }
  };
}
