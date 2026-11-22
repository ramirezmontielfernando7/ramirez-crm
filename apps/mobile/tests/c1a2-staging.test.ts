import assert from "node:assert/strict";
import { test } from "node:test";
import { createReadOnlyConversationClient } from "../src/integration/conversation-client";
import {
  RemoteAuthRepository,
  RemoteHttpError,
  stagingOrigin,
} from "../src/integration/remote-http";

test("staging rejects production, empty origin, HTTP remote and URL credentials", () => {
  for (const raw of [
    undefined,
    "",
    "https://DASH.demfort.com.:443",
    "https://child.dash.demfort.com",
    "http://staging.example.test",
    "https://user:pass@staging.example.test",
    "https://staging.example.test/?key=fake",
    "https://staging.example.test/api",
  ])
    assert.throws(() => stagingOrigin(raw));
  assert.equal(
    stagingOrigin("https://staging.example.test"),
    "https://staging.example.test",
  );
  assert.equal(stagingOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
});

function setup() {
  let saved: string | null = null;
  const calls: { url: string; init: RequestInit }[] = [];
  const responses: Response[] = [];
  const store = {
    get: async () => saved,
    set: async (_k: string, value: string) => {
      saved = value;
    },
    remove: async () => {
      saved = null;
    },
  };
  const make = (origin = "https://staging.example.test") =>
    new RemoteAuthRepository(
      "staging",
      origin,
      store,
      async (url, init) => {
        calls.push({ url, init });
        const response = responses.shift();
        if (!response) throw new Error("Offline fixture");
        return response;
      },
      () => 1_000,
    );
  const auth = make();
  const login = async () => {
    responses.push(
      Response.json({
        token: "fixture.signature",
        expiresAt: "2100-01-01T00:00:00.000Z",
      }),
    );
    await auth.signIn("fixture@example.test", "fixture");
  };
  return { auth, login, make, store, calls, responses };
}

test("login persists only signed token metadata, and read/revoke use bearer without cookies", async () => {
  const { auth, login, make, store, calls, responses } = setup();
  await login();
  assert.equal((await auth.restore())?.expiresAt, Date.parse("2100-01-01"));
  const saved = JSON.parse((await store.get())!);
  assert.deepEqual(Object.keys(saved).sort(), ["expiresAt", "origin", "token"]);
  const client = createReadOnlyConversationClient((path) => auth.read(path));
  responses.push(Response.json({ conversations: [], nextCursor: null }));
  assert.deepEqual(await client.page("opaque+cursor"), {
    conversations: [],
    nextCursor: null,
  });
  responses.push(Response.json({ messages: [] }));
  assert.deepEqual(await client.history("cv_a"), []);
  await assert.rejects(() => client.history("../bad"));
  await assert.rejects(() => auth.read("/api/contacts"), { status: 403 });
  responses.push(Response.json({ success: true }));
  await auth.signOut();
  assert.equal(await make().restore(), null);
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    [
      "/api/mobile/session",
      "/api/conversations",
      "/api/conversations/cv_a/messages",
      "/api/mobile/session/revoke",
    ],
  );
  assert.equal(
    new URL(calls[1]!.url).searchParams.get("cursor"),
    "opaque+cursor",
  );
  for (const [index, { init }] of calls.entries()) {
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    const headers = new Headers(init.headers);
    assert.equal(headers.has("cookie"), false);
    assert.equal(
      headers.get("authorization"),
      index === 0 ? null : "Bearer fixture.signature",
    );
  }
});

test("session storage is bound to origin and failed revalidation clears it", async () => {
  const { auth, login, make, responses, store } = setup();
  await login();
  assert.equal(await make("https://other.example.test").restore(), null);
  assert.equal(await store.get(), null);
  await login();
  responses.push(
    Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
  );
  await assert.rejects(() => auth.read("/api/conversations?limit=40"), {
    status: 401,
  });
  assert.equal(await auth.restore(), null);
});

test("maps suspension and rate limit; offline logout erases the local credential", async () => {
  const { auth, login, responses, store } = setup();
  for (const [status, code] of [
    [403, "ORGANIZATION_SUSPENDED"],
    [429, "TOO_MANY_REQUESTS"],
  ] as const) {
    responses.push(Response.json({ code }, { status }));
    await assert.rejects(
      () => auth.signIn("fixture@example.test", "fixture"),
      (err: unknown) =>
        err instanceof RemoteHttpError &&
        err.code === code &&
        err.status === status,
    );
  }
  await login();
  await assert.rejects(
    () => auth.signOut(),
    /No se pudo confirmar la revocación/,
  );
  assert.equal(await store.get(), null);
});
