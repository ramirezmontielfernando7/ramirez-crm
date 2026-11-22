import assert from "node:assert/strict";
import { test } from "node:test";
import { createReadOnlyConversationClient } from "../src/integration/conversation-client";
import {
  allowsRemoteRequest,
  RemoteAuthRepository,
  RemoteHttpError,
  remoteOrigin,
  requiresRemoteLogin,
  resolveBuildMode,
  type RemoteMode,
} from "../src/integration/remote-http";

const production = "https://dash.demfort.com";
const inbox = "/api/conversations";
const history = "/api/conversations/cv_fixture/messages";
const loginPath = "/api/mobile/session";
const revokePath = "/api/mobile/session/revoke";

test("production accepts only its literal HTTPS origin", () => {
  assert.equal(remoteOrigin("production", production), production);
  for (const raw of [
    undefined,
    "",
    "http://dash.demfort.com",
    "https://staging.demfort.com",
    "https://api.dash.demfort.com",
    "https://dash.demfort.com.example.test",
    "https://dash.demfort.com.",
    "https://DASH.demfort.com",
    `${production}/`,
    `${production}/api`,
    `${production}/a/..`,
    `${production}:443`,
    `${production}:444`,
    `${production}?`,
    `${production}#`,
    ` ${production} `,
    "https://fixture:fixture@dash.demfort.com",
  ]) {
    assert.throws(() => remoteOrigin("production", raw), /exactamente/);
  }
});

test("staging rejects production and the unset build mode selects demo", () => {
  assert.throws(() => remoteOrigin("staging", production));
  assert.equal(
    remoteOrigin("staging", "https://staging.demfort.com"),
    "https://staging.demfort.com",
  );
  assert.equal(resolveBuildMode(undefined), "demo");
  assert.equal(resolveBuildMode("demo"), "demo");
  assert.equal(resolveBuildMode("staging"), "staging");
  assert.equal(resolveBuildMode("production"), "production");
  assert.equal(resolveBuildMode(""), "invalid");
  assert.equal(resolveBuildMode("prod"), "invalid");
});

test("remote endpoint and method policy only admits inbox, history, login and revoke", () => {
  const methods = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
    "get",
  ];
  for (const [path, allowed] of [
    [inbox, "GET"],
    [`${inbox}?limit=40&cursor=opaque%2Bcursor`, "GET"],
    [history, "GET"],
    [loginPath, "POST"],
    [revokePath, "POST"],
    ["/api/contacts", ""],
    ["/api/conversations/cv_fixture/messages/send", ""],
    ["/api/conversations/%2e%2e/messages", ""],
    ["/api/conversations/../messages", ""],
    ["/api/conversations/cv_fixture/messages\n", ""],
    ["/api/conversations//messages", ""],
    ["/api/conversations/cv_fixture/messages?limit=1", ""],
    ["/api/conversations?token=fixture", ""],
    ["/api/conversations?cursor=fixture#fragment", ""],
    ["/api/conversations/?limit=2", ""],
    ["/api/mobile/session?token=fixture", ""],
    ["//example.test/api/conversations", ""],
    [`${production}${inbox}`, ""],
  ]) {
    for (const method of methods)
      assert.equal(
        allowsRemoteRequest(method, path!),
        method === allowed,
        `${method} ${JSON.stringify(path)}`,
      );
  }
});

function setup() {
  const records = new Map<string, string>();
  const calls: { url: string; init: RequestInit; stored: number }[] = [];
  const responses: Response[] = [];
  let now = 1_000;
  const make = (mode: RemoteMode) =>
    new RemoteAuthRepository(
      mode,
      mode === "production" ? production : "https://staging.demfort.com",
      {
        get: async (key) => records.get(key) ?? null,
        set: async (key, value) => {
          records.set(key, value);
        },
        remove: async (key) => {
          records.delete(key);
        },
      },
      async (url, init) => {
        calls.push({ url, init, stored: records.size });
        const response = responses.shift();
        if (!response) throw new Error("Offline fixture");
        return response;
      },
      () => now,
    );
  const auth = make("production");
  const signIn = async (repository = auth) => {
    responses.push(
      Response.json({
        token: "fixture.signature",
        expiresAt: "1970-01-01T00:00:03.000Z",
      }),
    );
    return repository.signIn("fixture@example.test", "fixture");
  };
  return {
    auth,
    make,
    signIn,
    records,
    calls,
    responses,
    setNow: (time: number) => {
      now = time;
    },
  };
}

test("production inbox and history call only the allowlist, and logout clears storage before revocation", async () => {
  const { auth, signIn, records, calls, responses } = setup();
  await signIn();
  const client = createReadOnlyConversationClient((path) => auth.read(path));
  responses.push(
    Response.json({ conversations: [], nextCursor: null }),
    Response.json({ messages: [] }),
  );
  await client.page();
  await client.history("cv_fixture");
  for (const path of [
    loginPath,
    revokePath,
    "/api/contacts",
    "/api/conversations/cv_fixture/messages/send",
    "/api/conversations?token=fixture",
  ])
    await assert.rejects(() => auth.read(path), { status: 403 });
  assert.equal(calls.length, 3);
  responses.push(Response.json({ success: true }));
  await auth.signOut();
  assert.equal(records.size, 0);
  assert.equal(calls[3]!.stored, 0);
  assert.deepEqual(
    calls.map(({ url, init }) => [
      new URL(url).origin,
      init.method,
      new URL(url).pathname,
    ]),
    [
      [production, "POST", loginPath],
      [production, "GET", inbox],
      [production, "GET", history],
      [production, "POST", revokePath],
    ],
  );
  for (const { init } of calls) {
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).has("cookie"), false);
  }
  assert.equal(
    new Headers(calls[3]!.init.headers).get("authorization"),
    "Bearer fixture.signature",
  );
});

test("staging and production persist under separate keys and reject expired credentials locally", async () => {
  const { auth, make, signIn, records, calls, setNow } = setup();
  const staging = make("staging");
  await signIn(staging);
  assert.equal(await auth.restore(), null);
  await signIn();
  assert.equal(records.size, 2);
  assert.equal(await auth.expireIfNeeded(), false);
  setNow(3_000);
  assert.equal(await auth.expireIfNeeded(), true);
  assert.equal(await auth.restore(), null);
  assert.equal(records.size, 1);
  await assert.rejects(
    () => staging.restore(),
    (error: unknown) =>
      requiresRemoteLogin(error) &&
      error.message === "Tu sesión caducó. Vuelve a iniciar sesión.",
  );
  assert.equal(records.size, 0);
  assert.equal(calls.length, 2);
});

test("401 and suspension clear the session and select the login notice", async () => {
  for (const [status, code, message] of [
    [
      401,
      "unauthorized",
      "Tu sesión ya no está activa. Vuelve a iniciar sesión.",
    ],
    [
      403,
      "organization_suspended",
      "Tu negocio está suspendido. Contacta a soporte de la plataforma.",
    ],
    [
      403,
      "ORGANIZATION_SUSPENDED",
      "Tu negocio está suspendido. Contacta a soporte de la plataforma.",
    ],
  ] as const) {
    const { auth, signIn, responses, records } = setup();
    await signIn();
    responses.push(
      Response.json(
        { error: { code, message: "untrusted fixture" } },
        { status },
      ),
    );
    await assert.rejects(
      () => auth.read(history),
      (error: unknown) =>
        requiresRemoteLogin(error) &&
        error.status === status &&
        error.message === message,
    );
    assert.equal(records.size, 0);
    assert.equal(await auth.restore(), null);
  }
});

test("429 and offline reads show a safe error and keep the local session", async () => {
  const { auth, signIn, responses, records } = setup();
  await signIn();
  responses.push(Response.json({ code: "fixture.untrusted" }, { status: 429 }));
  for (const [status, message] of [
    [429, "Demasiados intentos. Espera unos minutos."],
    [0, "Sin conexión con Dashfort. Reintenta."],
  ] as const) {
    await assert.rejects(
      () => auth.read(inbox),
      (error: unknown) =>
        error instanceof RemoteHttpError &&
        !requiresRemoteLogin(error) &&
        error.status === status &&
        error.message === message &&
        error.code === undefined,
    );
    assert.equal(records.size, 1);
  }
});
