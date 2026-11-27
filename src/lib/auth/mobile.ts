import { parseCookies, parseSetCookieHeader } from "better-auth/cookies";
import { getAuth } from "@/lib/auth";

const SESSION_COOKIE = "better-auth.session_token";
const SIGNED_TOKEN = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_+/=-]+$/;

/** Browser-managed requests cannot use the mobile credential exchange. */
export function isBrowserRequest(headers: Headers): boolean {
  return headers.has("origin") || headers.has("sec-fetch-site");
}

function bearerValue(headers: Headers): string | null {
  const token = /^Bearer ([^\s]+)$/i.exec(headers.get("authorization") ?? "")?.[1];
  return token && token.length <= 512 && SIGNED_TOKEN.test(token) ? token : null;
}

/** Format only. Better Auth verifies the signature and resolves the session. */
export async function mobileBearerHeaders(headers: Headers): Promise<Headers | null> {
  if (isBrowserRequest(headers)) return null;
  const token = bearerValue(headers);
  if (!token) return null;

  const cookies = parseCookies(headers.get("cookie") ?? "");
  const name = (await getAuth().$context).authCookies.sessionToken.name;
  if ([name, SESSION_COOKIE, `__Secure-${SESSION_COOKIE}`, `__Host-${SESSION_COOKIE}`].some((key) => cookies.has(key))) {
    return null;
  }

  // Give Better Auth just one credential. No other cookie can supply a cached session.
  return signedSessionHeaders(name, token);
}

export function signedSessionHeaders(name: string, token: string): Headers {
  return new Headers({ cookie: `${name}=${encodeURIComponent(token)}` });
}

export function signedTokenFromResponse(response: Response, name: string): string | null {
  const cookie = parseSetCookieHeader(response.headers.get("set-cookie") ?? "").get(name);
  return cookie && cookie["max-age"] !== 0 && SIGNED_TOKEN.test(cookie.value)
    ? cookie.value
    : null;
}
