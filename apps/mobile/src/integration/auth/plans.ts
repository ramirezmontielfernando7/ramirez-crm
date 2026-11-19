import { AuthFault } from "./model";
/** Describes protocol work only. No cookie parsing, native bridge or HTTP execution. */
export const backendAuthCapabilities = Object.freeze({
  revision: "daccd873eac667cc4eb19a9743e99df12538925a",
  version: "1.7.19",
  renewal: "cookie-revalidation",
  organizationSelection: false,
  referenceRevocation: false,
  nativeBridgeVerified: false,
});
export function authPlan(
  action: "login" | "restore" | "logout",
  origin: string,
) {
  if (origin !== "https://auth.test.invalid") throw new AuthFault("blocked");
  return Object.freeze({
    environment: "fixture-only",
    origin,
    method: action === "restore" ? "GET" : "POST",
    path:
      action === "login"
        ? "/api/auth/sign-in/email"
        : action === "restore"
          ? "/api/auth/get-session"
          : "/api/auth/sign-out",
    redirect: "error",
    transportEnabled: false,
    credentialPolicy: "opaque-native-bridge-required",
    csrfPolicy: "server-origin-check-required",
    tlsPolicy: "trusted-certificate-required",
  } as const);
}
export type Binding = Readonly<{
  environment: "fixture-only";
  installationId: string;
  userId: string;
  organizationId: string;
  sessionId: string;
}>;
/** Exact keys: storage/cache references never contain a cookie or a password. */
export function bindingKey(raw: Binding) {
  if (
    raw.environment !== "fixture-only" ||
    ![raw.installationId, raw.userId, raw.organizationId, raw.sessionId].every(
      (v) => typeof v === "string" && /^fixture-[\w-]{1,100}$/.test(v),
    )
  )
    throw new AuthFault("invalid");
  return [
    raw.environment,
    raw.installationId,
    raw.userId,
    raw.organizationId,
    raw.sessionId,
  ].join(":");
}
export class MemoryBindingMaterial {
  private values = new Map<string, Uint8Array>();
  replace(binding: Binding, bytes: Uint8Array) {
    const key = bindingKey(binding);
    if (
      bytes.length > 12000 ||
      !/^fixture-cookie-[\w-]{1,160}$/.test(new TextDecoder().decode(bytes))
    )
      throw new AuthFault("blocked");
    this.values.get(key)?.fill(0);
    this.values.set(key, bytes.slice());
  }
  load(binding: Binding) {
    return this.values.get(bindingKey(binding))?.slice() ?? null;
  }
  revoke(binding: Binding) {
    const key = bindingKey(binding);
    this.values.get(key)?.fill(0);
    this.values.delete(key);
  }
  clear() {
    for (const b of this.values.values()) b.fill(0);
    this.values.clear();
  }
}
