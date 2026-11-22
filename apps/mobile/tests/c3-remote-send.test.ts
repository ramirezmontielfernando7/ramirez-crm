import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowsRemoteRequest,
  remoteSendEnabled,
  RemoteAuthRepository,
  RemoteHttpError,
  requiresRemoteLogin,
  type RemoteMode,
} from "../src/integration/remote-http";

const id = "cv_sample";
const chat = `/api/conversations/${id}`;
const history = `${chat}/messages`;
const windowMessage =
  "La ventana de 24 horas está cerrada; usa una plantilla aprobada";

function fixture(mode: RemoteMode = "production", flag?: string) {
  const calls: {
    method?: string;
    path: string;
    body: unknown;
    headers: Headers;
  }[] = [];
  const responses: (() => Promise<Response>)[] = [];
  let stored: string | null = null;
  const auth = new RemoteAuthRepository(
    mode,
    mode === "production"
      ? "https://dash.demfort.com"
      : "https://staging.demfort.com",
    {
      get: async () => stored,
      set: async (_key, value) => {
        stored = value;
      },
      remove: async () => {
        stored = null;
      },
    },
    async (url, init) => {
      calls.push({
        method: init.method,
        path: new URL(url).pathname,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: new Headers(init.headers),
      });
      const next = responses.shift();
      if (!next) throw new Error("network fixture");
      return next();
    },
    () => 1_000,
    remoteSendEnabled(flag),
  );
  async function signIn() {
    responses.push(async () =>
      Response.json({
        token: "fixture.signature",
        expiresAt: "2100-01-01T00:00:00Z",
      }),
    );
    await auth.signIn("fixture@example.test", "fixture");
  }
  return { auth, calls, signIn, responses, saved: () => !!stored };
}

test("C3 extends only POST text and PATCH read for valid IDs", () => {
  assert.equal(allowsRemoteRequest("POST", history, true), true);
  assert.equal(allowsRemoteRequest("PATCH", chat, true), true);
  for (const path of [
    chat,
    history,
    `${chat}/messages/media`,
    `${chat}/messages/template`,
    `${history}?test=1`,
    "/api/conversations/%2e%2e",
    "/api/conversations",
    "/api/contacts",
    "/api/my-number/chats/cv_sample/messages",
    "/api/mobile/session/revoke/../session",
    "//external.example/api/conversations/cv_sample/messages",
  ]) {
    for (const method of [
      "POST",
      "PATCH",
      "PUT",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]) {
      assert.equal(
        allowsRemoteRequest(method, path, true),
        (path === history && method === "POST") ||
          (path === chat && method === "PATCH"),
      );
    }
  }
});

test("without the exact build flag both remote modes remain read-only", async () => {
  for (const mode of ["staging", "production"] as const) {
    for (const flag of [undefined, "false", "TRUE", "1"]) {
      const { auth, signIn, calls } = fixture(mode, flag);
      await signIn();
      await assert.rejects(() => auth.sendText(id, "Texto de prueba"), {
        status: 403,
      });
      await assert.rejects(() => auth.markRead(id), { status: 403 });
      assert.equal(calls.length, 1);
    }
  }
});

test("send text and markRead submit only the expected bodies; double tap shares the lock", async () => {
  for (const mode of ["staging", "production"] as const) {
    const { auth, signIn, calls, responses } = fixture(mode, "true");
    await signIn();
    const pair = Promise.withResolvers<Response>();
    responses.push(() => pair.promise);
    const sent = auth.sendText(id, " Texto ficticio ");
    assert.equal(await auth.sendText(id, " Texto ficticio "), null);
    pair.resolve(Response.json({ messageId: "msg_fixture" }));
    assert.deepEqual(await sent, { queued: false });
    responses.push(async () =>
      Response.json({ conversation: { unreadCount: 0 } }),
    );
    await auth.markRead(id);
    await assert.rejects(() => auth.sendText("../bad", "prueba"), {
      status: 403,
    });
    await assert.rejects(() => auth.sendText(id, "a".repeat(4097)), {
      status: 422,
    });
    await assert.rejects(() => auth.markRead("bad\n"), { status: 403 });
    assert.deepEqual(
      calls.slice(1).map(({ method, path, body }) => [method, path, body]),
      [
        ["POST", history, { text: "Texto ficticio" }],
        ["PATCH", chat, { markRead: true }],
      ],
    );
    for (const call of calls.slice(1)) {
      assert.equal(
        call.headers.get("authorization"),
        "Bearer fixture.signature",
      );
      assert.equal(call.headers.has("cookie"), false);
    }
  }
});

test("send errors preserve the window message and invalidate only expired or suspended sessions", async () => {
  for (const scenario of [
    { status: 500, code: "internal", expected: /No se pudo completar/ },
    { status: 401, code: "unauthorized", expected: /Vuelve a iniciar sesión/ },
    {
      status: 403,
      code: "organization_suspended",
      expected: /negocio está suspendido/,
    },
    { status: 429, code: "TOO_MANY_REQUESTS", expected: /Demasiados intentos/ },
    { status: 0, code: "", expected: /Sin conexión con Dashfort/ },
    { status: 409, code: "window_closed", expected: /ventana de 24 horas/ },
  ]) {
    const { auth, signIn, responses, saved, calls } = fixture(
      "production",
      "true",
    );
    await signIn();
    if (scenario.status)
      responses.push(async () =>
        Response.json(
          {
            error: {
              code: scenario.code,
              message:
                scenario.status === 409 ? windowMessage : "Untrusted fixture",
            },
          },
          { status: scenario.status },
        ),
      );
    const ends = scenario.status === 401 || scenario.status === 403;
    await assert.rejects(
      () => auth.sendText(id, "Texto ficticio"),
      (error: unknown) => {
        assert.ok(error instanceof RemoteHttpError);
        assert.equal(error.status, scenario.status);
        assert.equal(requiresRemoteLogin(error), ends);
        assert.match(error.message, scenario.expected);
        if (scenario.status === 409) assert.equal(error.message, windowMessage);
        return true;
      },
    );
    assert.equal(saved(), !ends);
    assert.equal(calls.length, 2);
  }
});
