import { createPrivateKey, sign, type KeyObject } from "node:crypto";

export interface MobilePushProvider {
  send(token: string, conversationId: string): Promise<"sent" | "invalid_token" | "unavailable">;
}

const oauthUrl = "https://oauth2.googleapis.com/token";
const fcmOrigin = "https://fcm.googleapis.com";
const fcmErrorType = "type.googleapis.com/google.firebase.fcm.v1.FcmError";

type Account = { project: string; email: string; key: KeyObject };

function parseAccount(raw: string): Account {
  const val = JSON.parse(raw) as Record<string, unknown> | null;
  if (val?.type !== "service_account" ||
    typeof val.project_id !== "string" || !/^[a-z][a-z0-9-]{4,29}$/.test(val.project_id) ||
    typeof val.client_email !== "string" || !/^[\w.+-]+@[\w.-]+\.gserviceaccount\.com$/.test(val.client_email) ||
    typeof val.private_key !== "string")
    throw new Error("Push configuration invalid");
  return { project: val.project_id, email: val.client_email, key: createPrivateKey(val.private_key) };
}

export function createFcmProvider(
  raw: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 2500,
): MobilePushProvider {
  const account = parseAccount(raw);
  let cached: { token: string; expires: number } | undefined;
  let exchange: Promise<string> | undefined;

  async function accessToken() {
    if (cached && cached.expires > Date.now()) return cached.token;
    if (!exchange) {
      exchange = (async () => {
        const issued = Math.floor(Date.now() / 1000);
        const claims = Buffer.from(JSON.stringify({
          iss: account.email, aud: oauthUrl, iat: issued, exp: issued + 3600,
          scope: "https://www.googleapis.com/auth/firebase.messaging",
        })).toString("base64url");
        const encoded = Buffer.from('{"alg":"RS256","typ":"JWT"}').toString("base64url") + "." + claims;
        const assertion = encoded + "." + sign("RSA-SHA256", Buffer.from(encoded), account.key).toString("base64url");
        const res = await fetcher(oauthUrl, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
          body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
        });
        if (!res.ok) throw new Error("Push authorization unavailable");
        const json = await res.json() as { access_token?: unknown; expires_in?: unknown };
        if (typeof json.access_token !== "string" || !json.access_token || typeof json.expires_in !== "number")
          throw new Error("Push authorization unavailable");
        cached = { token: json.access_token, expires: Date.now() + Math.max(0, json.expires_in - 60) * 1000 };
        return cached.token;
      })().finally(() => { exchange = undefined; });
    }
    return exchange;
  }

  return {
    async send(token, conversationId) {
      try {
        const credential = await accessToken();
        const res = await fetcher(`${fcmOrigin}/v1/projects/${account.project}/messages:send`, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
          headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
          body: JSON.stringify({ message: {
            token,
            notification: { title: "Dashfort", body: "Nuevo mensaje" },
            data: { type: "message.new", conversationId },
            android: {
              priority: "high", ttl: "60s", collapse_key: conversationId,
              notification: { channel_id: "messages", tag: conversationId, visibility: "PRIVATE" },
            },
          } }),
        });
        if (res.ok) return "sent";
        if (res.status === 401) cached = undefined;
        if (res.status === 400 || res.status === 404) {
          const body = await res.json() as { error?: { details?: { "@type"?: string; errorCode?: string }[] } };
          if (body.error?.details?.some((item) => item["@type"] === fcmErrorType &&
            (item.errorCode === "UNREGISTERED" || item.errorCode === "INVALID_ARGUMENT")))
            return "invalid_token";
        }
      } catch {
        // The provider response, token and account never enter logs.
      }
      return "unavailable";
    },
  };
}

let lastRaw: string | undefined;
let provider: MobilePushProvider | null;
export function mobilePushProvider(): MobilePushProvider | null {
  const value = process.env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  if (!value || value.startsWith("REEMPLAZA_")) return null;
  if (value !== lastRaw) {
    lastRaw = value;
    try { provider = createFcmProvider(value); }
    catch { provider = null; }
  }
  return provider;
}
