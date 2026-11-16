import assert from "node:assert/strict";
import { test } from "node:test";
import {
  environment,
  mobileRole,
  retryDecision,
  type ChangePage,
} from "../src/integration/contracts";
import { IsolatedCrm } from "../src/integration/simulation";
import { IntegrationSync } from "../src/integration/sync";
import {
  conversationRequest,
  conversationsResponse,
  messagesResponse,
  currentApiLimits,
} from "../src/integration/wire";
const login = (b: IsolatedCrm) =>
  b.login("operator@example.invalid", "fixture-password");
async function fixture() {
  let time = 2_000_000_000_000;
  const b = new IsolatedCrm("isolated-test", () => time),
    s = await login(b),
    sync = new IntegrationSync(b, () => time);
  sync.bind(s);
  return {
    b,
    s,
    sync,
    advance: (n: number) => {
      time += n;
    },
  };
}
test("experimental config refuses production, URLs, aliases and credentials-bearing origins", () => {
  assert.equal(environment("demo").remoteEnabled, false);
  assert.equal(environment("isolated-test").transport, "memory-only");
  for (const mode of ["production", "staging", ""] as never[])
    assert.throws(() => environment(mode));
  for (const origin of [
    "https://dash.demfort.com",
    "http://localhost:3000",
    "memory://test",
  ])
    assert.throws(() => environment("isolated-test", origin));
});
test("backend role names map explicitly; unknown role fails closed", () => {
  assert.equal(mobileRole("coordinador"), "coordinator");
  assert.equal(mobileRole("asesor"), "advisor");
  assert.throws(() => mobileRole("admin" as never));
});
test("mock auth rejects invalid login and offline new login", async () => {
  const f = await fixture();
  await assert.rejects(f.b.login("real@example.invalid", "bad"), {
    message: "unauthorized",
  });
  f.b.online = false;
  await assert.rejects(login(f.b), { message: "offline" });
});
test("mock refresh rotates a fixture binding and rejects old, expired or forged scope", async () => {
  const f = await fixture();
  const next = await f.b.refresh(f.s);
  await assert.rejects(f.b.validate(f.s), { message: "unauthorized" });
  await assert.rejects(
    f.b.validate({ ...next, organizationId: "fixture-org-b" }),
    { message: "unauthorized" },
  );
  f.advance(3600001);
  await assert.rejects(f.b.validate(next), { message: "unauthorized" });
});
test("cursor catch-up recovers events after offline with no duplicate entity", async () => {
  const f = await fixture();
  f.b.publish("fixture-chat");
  await f.sync.sync();
  f.b.online = false;
  f.b.publish("fixture-chat", "Cambio");
  await assert.rejects(f.sync.sync(), { message: "offline" });
  assert.equal(f.sync.snapshot().stale, true);
  f.b.online = true;
  await f.sync.sync();
  await f.sync.sync();
  assert.equal(f.sync.snapshot().rows.length, 1);
  assert.equal(f.sync.snapshot().rows[0]!.text, "Cambio");
});
test("organization switch clears local scope and cannot ingest another organization", async () => {
  const f = await fixture();
  f.b.publish("fixture-chat");
  f.b.publish("fixture-other", "B", "fixture-org-b");
  await f.sync.sync();
  const s = await f.b.switchOrganization(f.s, "fixture-org-b");
  f.sync.bind(s);
  assert.equal(f.sync.snapshot().rows.length, 0);
  await f.sync.sync();
  assert.deepEqual(
    f.sync.snapshot().rows.map((r) => r.id),
    ["fixture-other"],
  );
  await assert.rejects(f.b.switchOrganization(s, "foreign"), {
    message: "forbidden",
  });
});
test("late response from old session cannot populate current organization cache", async () => {
  const f = await fixture();
  let release!: () => void;
  f.b.beforeChanges = () =>
    new Promise<void>((r) => {
      release = r;
    });
  const old = f.sync.sync();
  await Promise.resolve();
  const next = await f.b.switchOrganization(f.s, "fixture-org-b");
  f.sync.bind(next);
  release();
  await old;
  assert.deepEqual(f.sync.snapshot().rows, []);
  assert.equal(f.sync.snapshot().cursor, 0);
});
test("duplicate and out-of-order proposed revisions do not resurrect tombstones", async () => {
  const f = await fixture();
  const old = f.b.publish("fixture-chat"),
    deleted = f.b.publish("fixture-chat", "", "fixture-org-a", true);
  const p: ChangePage = {
    organizationId: f.s.organizationId,
    cursor: 2,
    serverTime: 1,
    rows: [deleted, old, deleted],
  };
  const sync = new IntegrationSync({ changes: async () => p });
  sync.bind({ ...f.s, expiresAt: Date.now() + 100000 });
  await sync.sync();
  await sync.sync();
  assert.equal(sync.snapshot().rows.length, 0);
});
test("foreign organization payload rejects whole proposed page before applying any row", async () => {
  const f = await fixture();
  const a = f.b.publish("fixture-a"),
    b = f.b.publish("fixture-b", "Other", "fixture-org-b");
  const sync = new IntegrationSync(
    {
      changes: async () => ({
        organizationId: f.s.organizationId,
        cursor: 2,
        serverTime: 1,
        rows: [a, b],
      }),
    },
    () => 1,
  );
  sync.bind(f.s);
  await assert.rejects(sync.sync(), { message: "invalid" });
  assert.equal(sync.snapshot().cursor, 0);
  assert.equal(sync.snapshot().rows.length, 0);
});
test("reassignment tombstone removes cached conversation; future send is denied", async () => {
  const f = await fixture();
  f.b.publish("fixture-chat");
  await f.sync.sync();
  f.b.loseConversation("fixture-chat");
  await f.sync.sync();
  assert.equal(f.sync.snapshot().rows.length, 0);
  await assert.rejects(
    f.b.send(f.s, {
      conversationId: "fixture-chat",
      text: "Prueba",
      idempotencyKey: "fixture-key",
    }),
    { message: "not_found" },
  );
});
test("revocation, logout and session expiry clear synchronized data", async () => {
  for (const action of ["revoke", "logout", "expire"]) {
    const f = await fixture();
    f.b.publish("fixture-chat");
    await f.sync.sync();
    if (action === "revoke") f.b.revoke(f.s);
    else if (action === "logout") await f.b.logout(f.s);
    else f.advance(3600001);
    await assert.rejects(f.sync.sync(), { message: "unauthorized" });
    assert.equal(f.sync.snapshot().rows.length, 0);
  }
});
test("simultaneous sync shares one flight and error preserves prior data as stale", async () => {
  const f = await fixture();
  f.b.publish("fixture-chat");
  const a = f.sync.sync(),
    b = f.sync.sync();
  assert.equal(a, b);
  await a;
  f.b.failNext = true;
  await assert.rejects(f.sync.sync(), { message: "server" });
  assert.equal(f.sync.snapshot().rows.length, 1);
  assert.equal(f.sync.snapshot().stale, true);
  await f.sync.sync();
  assert.equal(f.sync.snapshot().stale, false);
  f.advance(30001);
  assert.equal(f.sync.snapshot().stale, true);
});
test("proposed isolated idempotency recognizes retry after lost response and rejects changed command", async () => {
  const f = await fixture();
  f.b.publish("fixture-chat");
  const c = {
    conversationId: "fixture-chat",
    text: "Mensaje de prueba",
    idempotencyKey: "fixture-operation",
  };
  f.b.uncertainNext = true;
  await assert.rejects(f.b.send(f.s, c), { message: "uncertain" });
  const a = await f.b.send(f.s, c);
  assert.deepEqual(await f.b.send(f.s, c), a);
  await assert.rejects(f.b.send(f.s, { ...c, text: "Otro" }), {
    message: "conflict",
  });
  assert.equal(currentApiLimits.sendIdempotencyKey, false);
});
test("current API uncertain writes are reconciliation-only; auth/access errors never retry blindly", () => {
  assert.equal(retryDecision("network", true), "reconcile-only");
  assert.equal(retryDecision(503, true), "reconcile-only");
  assert.equal(retryDecision(429, false), "retry-read");
  assert.equal(retryDecision(401, true), "reauthenticate");
  assert.equal(retryDecision(404, true), "invalidate");
});
test("current conversation query always uses bounded pagination and escapes text safely", () => {
  const r = conversationRequest({
    q: "a&assigned=foreign",
    assigned: "mine",
    limit: 50,
  });
  const u = new URL(r.path, "https://example.invalid");
  assert.equal(u.searchParams.get("q"), "a&assigned=foreign");
  assert.equal(u.searchParams.get("assigned"), "mine");
  assert.throws(() => conversationRequest({ limit: 501 }));
  assert.throws(() => conversationRequest({ q: "x".repeat(101) }));
});
test("current wire parsers reject wrong conversations and malformed responses, strip unrelated payload", () => {
  const m = {
    id: "msg-1",
    conversationId: "conv-1",
    direction: "in",
    status: "delivered",
    text: "Prueba",
    createdAt: "2026-01-01T00:00:00.000Z",
    aiGenerated: false,
  };
  assert.equal(
    messagesResponse(
      { messages: [{ ...m, token: "do-not-retain" }] },
      "conv-1",
    )[0]!.id,
    "msg-1",
  );
  assert.throws(() => messagesResponse({ messages: [m] }, "conv-2"));
  assert.throws(() =>
    messagesResponse({ messages: [{ ...m, status: "unexpected" }] }, "conv-1"),
  );
  assert.deepEqual(
    conversationsResponse({ conversations: [], nextCursor: null }),
    { conversations: [], nextCursor: null },
  );
  assert.throws(() => conversationsResponse({ conversations: [] }));
});
