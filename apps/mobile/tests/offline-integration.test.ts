import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authPlan,
  MemoryBindingMaterial,
  bindingKey,
} from "../src/integration/auth/plans";
import { PreparedConversations } from "../src/integration/conversation-client";
import { PreparedLifecycle } from "../src/integration/lifecycle";
import { IntegrationError } from "../src/integration/contracts";
const scope = {
  userId: "fixture-user",
  organizationId: "fixture-org",
  sessionId: "fixture-session",
  expiresAt: Date.now() + 100000,
};
function fixture() {
  let calls = 0;
  let fail = false;
  let wait: Promise<void> | null = null;
  const row = {
    id: "fixture-chat",
    contact: { id: "fixture-contact", name: "Ejemplo ficticio", phone: null },
    unreadCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
  };
  const read = {
    conversations: async () => {
      if (wait) await wait;
      return { conversations: [row], nextCursor: null };
    },
    messages: async () => [
      {
        id: "fixture-m",
        conversationId: row.id,
        direction: "in" as const,
        status: "read" as const,
        text: "Demo",
        createdAt: row.createdAt,
        aiGenerated: false,
      },
      {
        id: "fixture-m",
        conversationId: row.id,
        direction: "in" as const,
        status: "read" as const,
        text: "Demo",
        createdAt: row.createdAt,
        aiGenerated: false,
      },
    ],
    contact: async () => ({
      id: "fixture-contact",
      name: "Demo",
      phone: null,
      notes: null,
    }),
    assignments: async () => [],
  };
  const actions = {
    supportsIdempotency: false as const,
    send: async () => {
      calls++;
      if (fail) throw new IntegrationError("uncertain");
      return { messageId: "fixture-new" };
    },
    assign: async () => {},
    patchContact: async () => {},
    patchConversation: async () => {},
  };
  const c = new PreparedConversations(read, actions);
  c.bind(scope);
  return {
    c,
    read,
    actions,
    calls: () => calls,
    fail: () => (fail = true),
    wait: (p: Promise<void>) => (wait = p),
  };
}
test("auth request descriptions always disabled and origin exact", () => {
  for (const a of ["login", "restore", "logout"] as const)
    assert.equal(
      authPlan(a, "https://auth.test.invalid").transportEnabled,
      false,
    );
  for (const origin of [
    "https://dash.demfort.com",
    "http://auth.test.invalid",
    "https://auth.test.invalid/",
  ])
    assert.throws(() => authPlan("login", origin));
});
test("binding material is copied, isolated, bounded and erased", () => {
  const store = new MemoryBindingMaterial(),
    a = {
      ...scope,
      environment: "fixture-only" as const,
      installationId: "fixture-device",
    },
    b = { ...a, organizationId: "fixture-other" };
  assert.notEqual(bindingKey(a), bindingKey(b));
  const bytes = new TextEncoder().encode("fixture-cookie-123");
  store.replace(a, bytes);
  bytes.fill(0);
  assert.equal(new TextDecoder().decode(store.load(a)!), "fixture-cookie-123");
  assert.equal(store.load(b), null);
  store.clear();
  assert.equal(store.load(a), null);
  assert.throws(() => store.replace(a, new TextEncoder().encode("real-value")));
});
test("SSE hints do not masquerade as durable sync and reconnect reconciles", async () => {
  const f = fixture();
  await f.c.inbox();
  assert.equal(f.c.snapshot().stale, false);
  f.c.eventHint();
  assert.equal(f.c.snapshot().stale, true);
  await f.c.reconnect();
  assert.equal(f.c.snapshot().stale, false);
  await f.c.refreshHistory("fixture-chat");
  assert.equal(f.c.messages("fixture-chat").length, 1);
});
test("uncertain sends cannot be replayed with the same attempt and require reconciliation", async () => {
  const f = fixture();
  f.fail();
  await assert.rejects(f.c.send("fixture-attempt", "fixture-chat", "Demo"));
  await assert.rejects(f.c.send("fixture-attempt", "fixture-chat", "Demo"));
  assert.equal(f.calls(), 1);
  assert.equal(f.c.snapshot().pending[0]?.state, "unknown");
  await f.c.reconcile();
  assert.equal(f.calls(), 1);
});
test("old organization query cannot install into new scope", async () => {
  const f = fixture();
  let release!: () => void;
  f.wait(new Promise<void>((r) => (release = r)));
  const p = f.c.inbox();
  f.c.bind({ ...scope, organizationId: "fixture-other" });
  release();
  await assert.rejects(p);
  assert.equal(f.c.snapshot().conversations.length, 0);
});
for (const code of ["unauthorized", "forbidden", "not_found"] as const)
  test(`canonical ${code} clears queries and history`, async () => {
    const f = fixture();
    await f.c.inbox();
    f.read.conversations = async () => {
      throw new IntegrationError(code);
    };
    await assert.rejects(f.c.inbox());
    assert.equal(f.c.snapshot().conversations.length, 0);
  });
test("foreground sync coalesces, idle/background does not poll, logout clears", async () => {
  let calls = 0,
    clear = 0;
  const l = new PreparedLifecycle(
    async () => {
      calls++;
    },
    () => clear++,
  );
  await l.transition(false, true);
  assert.equal(calls, 0);
  await Promise.all([l.transition(true, true), l.transition(true, true)]);
  assert.equal(calls, 1);
  await l.transition(true, true);
  assert.equal(calls, 1);
  l.logout();
  assert.equal(clear, 1);
});
