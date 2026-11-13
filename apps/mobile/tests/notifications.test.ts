import assert from "node:assert/strict";
import { test } from "node:test";
import { NotificationStore } from "../src/features/notifications/core";
import { DemoNotificationBackend } from "../src/features/notifications/adapters/demo";
import {
  ORG_A,
  ORG_B,
  decodeEvent,
  type Identity,
  type ConversationSnapshot,
} from "../src/features/notifications/model";
import { DemoRegistration } from "../src/features/notifications/registration";
import { InboxStore } from "../src/features/inbox/store-core";
const time = 2_000_000_000_000;
const identity = (userId = "demo-owner", organizationId = ORG_A): Identity => ({
  userId,
  organizationId,
  sessionId: "demo-session-1",
  expiresAt: time + 3600000,
});
function memory() {
  const data = new Map<string, string>();
  let fail = false;
  return {
    data,
    setFail: (v: boolean) => {
      fail = v;
    },
    async get(k: string) {
      if (fail) throw Error("storage failed");
      return data.get(k) ?? null;
    },
    async set(k: string, v: string) {
      if (fail) throw Error("storage failed");
      data.set(k, v);
    },
  };
}
async function fixture(i: Identity | null = identity(), shared = memory()) {
  let now = time;
  const backend = new DemoNotificationBackend(() => now),
    opened: string[] = [],
    projected: ConversationSnapshot[] = [];
  const store = new NotificationStore(
    backend,
    shared,
    {
      activeChat: () => null,
      canOpen: (i, id) => {
        try {
          backend.authorize(i, id);
          return true;
        } catch {
          return false;
        }
      },
      open: (id) => {
        opened.push(id);
      },
      apply: async (i, rows, current) => {
        if (current()) projected.push(...rows);
      },
    },
    () => now,
  );
  await store.hydrate();
  store.identity(i);
  store.permission("granted");
  await store.flush();
  return {
    store,
    backend,
    shared,
    opened,
    projected,
    advance: (n: number) => {
      now += n;
    },
    publish: (
      id: string,
      extra: Partial<Parameters<typeof backend.publish>[0]> = {},
    ) => backend.publish({ eventId: id, ...extra }),
  };
}
test("strict contract rejects URLs, versions, malformed IDs and copies no sensitive fields", () => {
  const b = new DemoNotificationBackend(() => time),
    e = b.publish({ eventId: "demo-event-1" });
  const clean = decodeEvent({
    ...e,
    title: "Nombre secreto",
    body: "Texto privado",
    url: "https://example.com",
  });
  assert.deepEqual(clean, e);
  for (const change of [
    { version: 2 },
    { eventId: "https://x" },
    { expiresAt: time },
    { sequence: -1 },
    { organizationId: "prod-org" },
    { conversationId: "../../web" },
  ])
    assert.throws(() => decodeEvent({ ...e, ...change }));
});
test("simulated registration rotates, atomically rebinds and revokes only one fictitious installation", () => {
  const b = new DemoNotificationBackend(() => time),
    a = new DemoRegistration("demo-install-a", b),
    c = new DemoRegistration("demo-install-b", b);
  a.reconcile(identity(), "granted", true);
  c.reconcile(identity(), "granted", true);
  const old = a.token;
  a.reconcile(identity(), "granted", true, true);
  assert.notEqual(a.token, old);
  a.reconcile(identity("demo-coordinator"), "granted", true);
  assert.equal(
    b.registrations.get("demo-install-a")!.identity.userId,
    "demo-coordinator",
  );
  a.reconcile(identity("demo-coordinator"), "revoked", false);
  assert.equal(a.token, null);
  assert.equal(a.pendingRevocation, true);
  assert.equal(b.registrations.size, 2);
  a.reconcile(null, "revoked", true);
  assert.equal(b.registrations.has("demo-install-a"), false);
  assert.equal(b.registrations.has("demo-install-b"), true);
  assert.throws(() =>
    b.register(identity(), "real-installation", "real-token"),
  );
});
test("permission denied and revoked hide groups, yet synchronization remains possible", async () => {
  const f = await fixture();
  f.store.permission("denied");
  await f.store.receive(f.publish("demo-event-a"));
  assert.equal(f.store.snapshot().groups.length, 0);
  assert.equal(f.store.snapshot().registered, false);
  assert.ok(f.projected.length > 0);
  f.store.permission("granted");
  await f.store.receive(f.publish("demo-event-b"));
  assert.equal(f.store.snapshot().groups.length, 1);
  f.store.permission("revoked");
  assert.equal(f.store.snapshot().groups.length, 0);
  assert.equal(f.backend.registrations.size, 0);
});
test("duplicate sources and out-of-order delivery produce one generic group per conversation", async () => {
  const f = await fixture();
  await f.store.foreground(false);
  const a = f.publish("demo-event-a"),
    b = f.publish("demo-event-b");
  await f.store.receive(b);
  await f.store.receive(a);
  await f.store.receive(b);
  assert.equal(f.store.snapshot().groups.length, 1);
  assert.equal(f.store.snapshot().groups[0]!.eventId, b.eventId);
  assert.equal(f.store.snapshot().seen.length, 2);
  assert.deepEqual(
    Object.keys(f.store.snapshot().groups[0]!).sort(),
    [
      "body",
      "conversationId",
      "eventId",
      "key",
      "organizationId",
      "sequence",
      "title",
    ].sort(),
  );
  assert.equal(
    f.store.snapshot().groups[0]!.body,
    "Tienes un aviso nuevo en Dashfort",
  );
  await assert.rejects(
    Promise.resolve().then(() =>
      f.backend.publish({ eventId: b.eventId, kind: "note" }),
    ),
    /reutilizado/,
  );
});
test("outgoing, AI, notes, status, expired and other-org events do not alert", async () => {
  const f = await fixture();
  await f.store.foreground(false);
  for (const kind of ["message.outgoing", "ai", "note", "status"] as const)
    await f.store.receive(
      f.publish(`demo-event-${kind.replace(".", "-")}`, { kind }),
    );
  await f.store.receive(
    f.publish("demo-event-expired", {
      occurredAt: time - 7200000,
      expiresAt: time - 3600000,
    }),
  );
  await f.store.receive(
    f.publish("demo-event-b", {
      organizationId: ORG_B,
      conversationId: "demo-b-conv-1",
    }),
  );
  assert.equal(f.store.snapshot().groups.length, 0);
  assert.equal(f.store.snapshot().seen.length, 0);
});
test("org cursors, scopes and subscriptions are isolated even when conversation events interleave", async () => {
  const f = await fixture();
  const a = f.publish("demo-event-a");
  f.publish("demo-event-b", {
    organizationId: ORG_B,
    conversationId: "demo-b-conv-1",
  });
  await f.store.sync();
  assert.equal(f.store.snapshot().cursor, 1);
  f.store.identity(identity("demo-owner", ORG_B));
  await f.store.sync();
  assert.equal(f.store.snapshot().cursor, 1);
  assert.deepEqual(f.store.snapshot().seen, ["demo-event-b"]);
  f.store.identity(identity());
  await f.store.sync();
  assert.deepEqual(f.store.snapshot().seen, [a.eventId]);
  assert.equal(f.backend.registrations.size, 1);
});
test("advisor scope and handoff audience checked before receipt and opening", async () => {
  const f = await fixture(identity("demo-advisor"));
  const foreign = f.publish("demo-event-foreign", { kind: "handoff" });
  await f.store.receive(foreign);
  assert.equal(f.store.snapshot().groups.length, 0);
  assert.equal(await f.store.tap(foreign), "denied");
  const own = f.publish("demo-event-own", {
    kind: "handoff",
    conversationId: "demo-conv-3",
  });
  assert.equal(await f.store.tap(own), "opened");
  assert.deepEqual(f.opened, ["demo-conv-3"]);
});
test("payload cannot extend expiry or redirect a canonical event to another conversation", async () => {
  const f = await fixture();
  const e = f.publish("demo-event-expired", {
    occurredAt: time - 7200000,
    expiresAt: time - 1000,
  });
  assert.equal(await f.store.tap({ ...e, expiresAt: time + 100000 }), "denied");
  const valid = f.publish("demo-event-valid");
  assert.equal(
    await f.store.tap({ ...valid, conversationId: "demo-conv-2" }),
    "denied",
  );
  assert.deepEqual(f.opened, []);
});
test("pending destination survives cold hydration without session and opens only once after authorization", async () => {
  const f = await fixture(null);
  const e = f.publish("demo-event-pending");
  assert.equal(await f.store.tap(e), "needs-session");
  await f.store.flush();
  const opened: string[] = [];
  const restored = new NotificationStore(
    f.backend,
    f.shared,
    {
      apply: async () => {},
      activeChat: () => null,
      canOpen: () => true,
      open: (id) => {
        opened.push(id);
      },
    },
    () => time,
  );
  await restored.hydrate();
  assert.ok(restored.snapshot().pending);
  restored.identity(identity());
  await Promise.all([restored.openPending(), restored.openPending()]);
  assert.deepEqual(opened, ["demo-conv-1"]);
  assert.equal(await restored.tap(e), "duplicate");
  assert.equal(opened.length, 1);
});
test("offline click preserves intent; reconnect sync keeps all messages but suppresses expired alerts", async () => {
  const f = await fixture();
  await f.store.connection(false);
  const e = f.publish("demo-event-a");
  f.publish("demo-event-old", {
    occurredAt: time - 7200000,
    expiresAt: time - 1000,
  });
  assert.equal(await f.store.tap(e), "offline");
  assert.ok(f.store.snapshot().pending);
  await f.store.connection(true);
  assert.equal(f.store.snapshot().groups.length, 1);
  await f.store.openPending();
  assert.deepEqual(f.opened, ["demo-conv-1"]);
  assert.ok(f.projected.some((c) => c.messages.length === 2));
});
test("role loss and expired session clear local groups and revoke registration", async () => {
  const f = await fixture();
  await f.store.receive(f.publish("demo-event-a"));
  f.backend.setMembership(ORG_A, "demo-owner", false);
  await f.store.sync();
  assert.equal(f.store.snapshot().groups.length, 0);
  assert.equal(f.store.snapshot().registered, false);
  assert.equal(f.backend.registrations.size, 0);
  f.backend.setMembership(ORG_A, "demo-owner", true);
  f.store.permission("granted");
  f.advance(3600001);
  await f.store.sync();
  assert.equal(f.store.snapshot().registered, false);
  assert.deepEqual(f.opened, []);
});
test("assignment revocation after a click blocks the destination", async () => {
  const f = await fixture(identity("demo-advisor"));
  await f.store.connection(false);
  const e = f.publish("demo-event-a", { conversationId: "demo-conv-3" });
  await f.store.tap(e);
  f.backend.assign(ORG_A, "demo-conv-3", "demo-owner");
  await f.store.connection(true);
  assert.equal(await f.store.openPending(), "denied");
  assert.deepEqual(f.opened, []);
});
test("single-flight synchronization ignores data returning after logout or account change", async () => {
  const f = await fixture();
  f.publish("demo-event-a");
  let release = () => {},
    started = () => {};
  const gate = new Promise<void>((r) => (release = r)),
    start = new Promise<void>((r) => (started = r));
  const original = f.backend.sync;
  f.backend.sync = async (i, c) => {
    const page = await original(i, c);
    started();
    await gate;
    return page;
  };
  const first = f.store.sync(),
    second = f.store.sync();
  assert.equal(first, second);
  await start;
  f.store.identity(null);
  release();
  await first;
  assert.deepEqual(f.projected, []);
  assert.equal(f.store.snapshot().cursor, 0);
  assert.equal(f.store.snapshot().syncing, false);
  assert.equal(f.backend.registrations.size, 0);
});
test("failed synchronization does not advance cursor, and retries synchronize once", async () => {
  const f = await fixture();
  f.publish("demo-event-a");
  f.backend.failNextSync = true;
  await f.store.sync();
  assert.equal(f.store.snapshot().cursor, 0);
  assert.match(f.store.snapshot().error, /Falló/);
  await f.store.sync();
  assert.equal(f.store.snapshot().cursor, 1);
  assert.equal(f.store.snapshot().groups.length, 1);
});
test("persistent dedupe survives client recreation and no message text/token is stored", async () => {
  const f = await fixture();
  await f.store.foreground(false);
  const e = f.publish("demo-event-a");
  await f.store.receive(e);
  await f.store.flush();
  const raw = f.shared.data.get(f.store.key)!;
  assert.ok(!raw.includes("demo-token"));
  assert.ok(!raw.includes("Tienes un aviso"));
  assert.ok(!raw.includes("sessionId"));
  const next = new NotificationStore(
    f.backend,
    f.shared,
    f.store.projection,
    () => time,
  );
  await next.hydrate();
  next.identity(identity());
  next.permission("granted");
  await next.foreground(false);
  await next.receive(e);
  assert.equal(next.snapshot().groups.length, 0);
});
test("corrupt storage remains untouched and cannot produce navigation or overwrite evidence", async () => {
  const f = await fixture();
  f.shared.data.set(f.store.key, '{"version":999}');
  const next = new NotificationStore(
    f.backend,
    f.shared,
    f.store.projection,
    () => time,
  );
  await next.hydrate();
  assert.equal(next.snapshot().ready, false);
  next.identity(identity());
  next.permission("granted");
  assert.equal(next.snapshot().registered, false);
  assert.equal(f.backend.registrations.size, 0);
  await next.flush().catch(() => {});
  assert.equal(f.shared.data.get(f.store.key), '{"version":999}');
  assert.equal(await next.tap(f.publish("demo-event-a")), "error");
  assert.deepEqual(f.opened, []);
});
test("failed navigation persistence keeps the pending destination available for safe retry", async () => {
  const f = await fixture();
  const e = f.publish("demo-event-a");
  await f.store.connection(false);
  await f.store.tap(e);
  await f.store.connection(true);
  f.shared.setFail(true);
  await f.store.openPending();
  assert.ok(f.store.snapshot().pending);
  assert.deepEqual(f.opened, []);
  f.shared.setFail(false);
  await f.store.openPending();
  assert.deepEqual(f.opened, ["demo-conv-1"]);
});
test("logout removes groups, pending target and registration; offline revocation drains later", async () => {
  const f = await fixture();
  const e = f.publish("demo-event-a");
  await f.store.connection(false);
  await f.store.tap(e);
  f.store.identity(null);
  assert.equal(f.store.snapshot().pending, null);
  assert.equal(f.store.snapshot().registered, false);
  assert.equal(f.store.snapshot().revocationPending, true);
  await f.store.connection(true);
  assert.equal(f.backend.registrations.size, 0);
});
test("resuming foreground coalesces missed conversation messages, and repeated resume does no work", async () => {
  const f = await fixture();
  await f.store.foreground(false);
  f.publish("demo-event-a");
  f.publish("demo-event-b");
  await f.store.foreground(true);
  assert.equal(f.store.snapshot().groups.length, 1);
  assert.equal(f.store.snapshot().groups[0]!.eventId, "demo-event-b");
  const n = f.projected.length;
  await f.store.foreground(true);
  assert.equal(f.projected.length, n);
});
test("projection adds only unseen canonical messages to Inbox and repeated snapshots do not notify", () => {
  const inbox = new InboxStore({ id: "demo-owner", role: "owner" });
  let notifications = 0;
  inbox.subscribe(() => notifications++);
  const before = inbox.repository.get(inbox.actor, "demo-conv-1").unread;
  inbox.reconcileNotification("demo-conv-1", ["demo-event-a", "demo-event-b"]);
  assert.equal(
    inbox.repository.get(inbox.actor, "demo-conv-1").unread,
    before + 2,
  );
  inbox.reconcileNotification("demo-conv-1", ["demo-event-b", "demo-event-a"]);
  assert.equal(notifications, 1);
});
test("cold-start callback and live tap for the same event navigate exactly once", async () => {
  const f = await fixture();
  const e = f.publish("demo-event-a");
  await Promise.all([f.store.tap(e), f.store.tap(e)]);
  assert.deepEqual(f.opened, ["demo-conv-1"]);
  assert.equal(f.store.snapshot().pending, null);
});
test("duplicate deliveries after success cause neither writes nor projections", async () => {
  const f = await fixture();
  await f.store.foreground(false);
  const e = f.publish("demo-event-a");
  await f.store.receive(e);
  let writes = 0;
  const set = f.shared.set;
  f.shared.set = async (k, v) => {
    writes++;
    await set(k, v);
  };
  await f.store.receive(e);
  assert.equal(writes, 0);
  assert.deepEqual(f.projected, []);
});
test("failed final routing write rolls back consumption and retries without opening twice", async () => {
  const f = await fixture();
  const e = f.publish("demo-event-a");
  await f.store.connection(false);
  await f.store.tap(e);
  await f.store.connection(true);
  let writes = 0;
  const set = f.shared.set;
  f.shared.set = async (k, v) => {
    writes++;
    if (writes === 2) throw Error("failed route write");
    await set(k, v);
  };
  assert.equal(await f.store.openPending(), "error");
  assert.ok(f.store.snapshot().pending);
  assert.equal(f.store.snapshot().opened.length, 0);
  assert.deepEqual(f.opened, []);
  f.shared.set = set;
  assert.equal(await f.store.openPending(), "opened");
  assert.deepEqual(f.opened, ["demo-conv-1"]);
});
test("group expiry is applied on resync and stale alerts are never regenerated", async () => {
  const f = await fixture();
  await f.store.receive(f.publish("demo-event-a"));
  f.advance(3600001);
  await f.store.sync();
  assert.equal(f.store.snapshot().groups.length, 0);
});
test("identity validation fails closed for missing, invalid or forged expiry/session fields", () => {
  const backend = new DemoNotificationBackend(() => time);
  for (const change of [
    { expiresAt: NaN },
    { expiresAt: undefined },
    { expiresAt: time },
    { sessionId: "real-token" },
    { userId: "__proto__" },
    { organizationId: "prod-org" },
  ])
    assert.throws(() =>
      backend.authorize({ ...identity(), ...change } as Identity),
    );
});
test("pending cold-start intent waits for router readiness without consumption", async () => {
  const f = await fixture();
  let ready = false;
  f.store.projection.ready = () => ready;
  const e = f.publish("demo-event-a");
  assert.equal(await f.store.tap(e), "needs-navigation");
  assert.ok(f.store.snapshot().pending);
  assert.deepEqual(f.opened, []);
  ready = true;
  assert.equal(await f.store.openPending(), "opened");
  assert.deepEqual(f.opened, ["demo-conv-1"]);
});
test("restarting a client retires the prior fake binding before new permission", async () => {
  const f = await fixture();
  assert.equal(f.backend.registrations.size, 1);
  await f.store.connection(false);
  f.store.identity(null);
  await f.store.flush();
  const next = new NotificationStore(
    f.backend,
    f.shared,
    f.store.projection,
    () => time,
  );
  await next.hydrate();
  assert.equal(f.backend.registrations.size, 0);
  assert.equal(next.snapshot().registered, false);
});
test("bursts coalesce persistent writes while retaining every event in the scoped ledger", async () => {
  const f = await fixture();
  await f.store.foreground(false);
  await f.store.flush();
  let writes = 0;
  const set = f.shared.set;
  f.shared.set = async (k, v) => {
    writes++;
    await set(k, v);
  };
  const events = Array.from({ length: 300 }, (_, n) =>
    f.publish(`demo-burst-${n}`),
  );
  await Promise.all(events.map((e) => f.store.receive(e)));
  await f.store.flush();
  assert.equal(f.store.snapshot().seen.length, 300);
  assert.ok(writes <= 2, `writes=${writes}`);
  const data = JSON.parse(f.shared.data.get(f.store.key)!);
  assert.equal(data.scopes[0][1].seen.length, 300);
  assert.equal(f.store.snapshot().groups.length, 1);
});
test("different conversations group independently with no customer details in their copy", async () => {
  const f = await fixture();
  await f.store.foreground(false);
  await f.store.receive(f.publish("demo-event-a"));
  await f.store.receive(
    f.publish("demo-event-b", { conversationId: "demo-conv-2" }),
  );
  assert.equal(f.store.snapshot().groups.length, 2);
  assert.equal(new Set(f.store.snapshot().groups.map((g) => g.key)).size, 2);
});
test("foreground active chat suppresses its alert but still synchronizes the incoming message", async () => {
  const f = await fixture();
  f.store.projection.activeChat = () => "demo-conv-1";
  await f.store.receive(f.publish("demo-event-a"));
  assert.equal(f.store.snapshot().groups.length, 0);
  assert.ok(
    f.projected.some((c) => c.messages.some((m) => m.id === "demo-event-a")),
  );
});
