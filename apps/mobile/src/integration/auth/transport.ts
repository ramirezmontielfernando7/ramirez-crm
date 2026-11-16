import { AuthFault } from "./model";
/** Future HTTP request description. No fetch, socket, client or production activation flag exists. */
export type PlannedRequest = Readonly<{
  method: "GET" | "POST";
  path: string;
  redirect: "error";
  credentials: "omit";
}>;
const paths = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/get-session",
  "/api/auth/sign-out",
]);
export function requestPlan(
  method: PlannedRequest["method"],
  path: string,
): PlannedRequest {
  if (
    !paths.has(path) ||
    !["GET", "POST"].includes(method) ||
    (path === "/api/auth/get-session" ? method !== "GET" : method !== "POST")
  )
    throw new AuthFault("blocked");
  return Object.freeze({
    method,
    path,
    redirect: "error",
    credentials: "omit",
  });
}
export function validateFutureDestination(
  value: string,
  expectedOrigin: string,
): string {
  // Pure validator: receiving an allowed URL NEVER enables a transport.
  let url: URL, origin: URL;
  try {
    url = new URL(value);
    origin = new URL(expectedOrigin);
  } catch {
    throw new AuthFault("blocked");
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== expectedOrigin ||
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    url.hash ||
    !paths.has(url.pathname) ||
    url.search ||
    url.href !== value ||
    /%|\\|[\r\n]/.test(value)
  )
    throw new AuthFault("blocked");
  return url.href;
}
export function acceptResponseStatus(status: number): void {
  if (status >= 300 && status < 400) throw new AuthFault("redirect");
  if (status === 401) throw new AuthFault("unauthorized");
  if (status === 403) throw new AuthFault("forbidden");
  if (status >= 400) throw new AuthFault("server");
  if (status < 200 || status >= 300) throw new AuthFault("invalid");
}
export class DisabledAuthenticatedHttp {
  /** All attempts blocked, including otherwise valid staging plans; no injected live sender. */
  async execute(_plan: PlannedRequest): Promise<never> {
    throw new AuthFault("blocked");
  }
}
