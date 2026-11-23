import { generateKeyPairSync, verify } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createFcmProvider, mobilePushProvider } from "@/server/mobile-push/fcm";

const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config = JSON.stringify({
  type: "service_account", project_id: "fixture-dashfort",
  client_email: "fixture@fixture-dashfort.iam.gserviceaccount.com",
  private_key: key.privateKey.export({ type: "pkcs8", format: "pem" }),
});

it("does not initialize FCM with the connector disabled or an invalid account", () => {
  vi.stubEnv("FCM_SERVICE_ACCOUNT_JSON", "");
  try {
    expect(mobilePushProvider()).toBeNull();
    vi.stubEnv("FCM_SERVICE_ACCOUNT_JSON", "REEMPLAZA_FCM_SERVICE_ACCOUNT_JSON");
    expect(mobilePushProvider()).toBeNull();
    vi.stubEnv("FCM_SERVICE_ACCOUNT_JSON", "{}");
    expect(mobilePushProvider()).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});

it("signs OAuth requests, reuses authorization and distinguishes documented token errors", async () => {
  const detail = (errorCode: string, status: number) => Response.json({
    error: { details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }] },
  }, { status });
  const responses = [new Response(null, { status: 200 }), detail("UNREGISTERED", 404),
    detail("INVALID_ARGUMENT", 400), Response.json({}, { status: 400 }), new Response(null, { status: 500 })];
  const http = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      const jwt = (init!.body as URLSearchParams).get("assertion")!.split(".");
      expect(verify("RSA-SHA256", Buffer.from(jwt.slice(0, 2).join(".")), key.publicKey, Buffer.from(jwt[2]!, "base64url"))).toBe(true);
      expect(JSON.parse(Buffer.from(jwt[1]!, "base64url").toString()).scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
      return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    }
    expect(String(url)).toBe("https://fcm.googleapis.com/v1/projects/fixture-dashfort/messages:send");
    const body = JSON.parse(String(init?.body));
    expect(body.message.data).toEqual({ type: "message.new", conversationId: "cv_fixture" });
    expect(body.message.notification).toEqual({ title: "Dashfort", body: "Nuevo mensaje" });
    expect(body.message.android.notification).toEqual({ channel_id: "messages", tag: "cv_fixture", visibility: "PRIVATE" });
    return responses.shift()!;
  });
  const provider = createFcmProvider(config, http);
  for (const result of ["sent", "invalid_token", "invalid_token", "unavailable", "unavailable"])
    expect(await provider.send("fixture-token", "cv_fixture")).toBe(result);
  expect(http).toHaveBeenCalledTimes(6);
});

it("gives up on delivery timeout without a retry", async () => {
  const http = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    }
    return new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("test deadline")), 500);
      init!.signal!.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(init!.signal!.reason);
      }, { once: true });
    });
  });
  const provider = createFcmProvider(config, http, 15);
  expect(await provider.send("fixture-token", "cv_fixture")).toBe("unavailable");
  expect(http).toHaveBeenCalledTimes(2);
});
