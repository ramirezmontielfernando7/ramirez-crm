import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LocalNotifications,
  type LocalPermission,
  type LocalPort,
} from "../src/features/notifications/local";
import { NotificationStore } from "../src/features/notifications/core";
import { DemoNotificationBackend } from "../src/features/notifications/adapters/demo";
import {
  ORG_A,
  ORG_B,
  type Identity,
} from "../src/features/notifications/model";
const now = 2_000_000_000_000;
const identity = (organizationId = ORG_A, userId = "demo-owner"): Identity => ({
  userId,
  organizationId,
  sessionId: "demo-session-test",
  expiresAt: now + 3600000,
});
const memory = () => {
  const data = new Map<string, string>();
  return {
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => {
      data.set(k, v);
    },
  };
};
async function fixture(storage = memory()) {
  const b = new DemoNotificationBackend(() => now),
    opened: string[] = [],
    scheduled: string[] = [],
    cancelled: string[] = [];
  let permission: LocalPermission = "granted",
    fail = false;
  const store = new NotificationStore(
    b,
    storage,
    {
      activeChat: () => null,
      canOpen: (i, id) => {
        try {
          b.authorize(i, id);
          return i.organizationId === ORG_A;
        } catch {
          return false;
        }
      },
      open: (id) => {
        opened.push(id);
      },
      apply: async () => {},
    },
    () => now,
  );
  const port: LocalPort = {
    permission: async () => permission,
    schedule: async (id) => {
      scheduled.push(id);
      if (fail) throw Error("schedule failed");
    },
    cancel: async (id) => {
      cancelled.push(id);
    },
  };
  const local = new LocalNotifications(store, port, storage, () => now);
  await local.hydrate();
  await store.hydrate();
  store.identity(identity());
  await store.flush();
  const event = (id = "demo-local-event", extra = {}) =>
    b.publish({ eventId: id, ...extra });
  return {
    b,
    store,
    local,
    event,
    scheduled,
    cancelled,
    opened,
    storage,
    setPermission: (v: LocalPermission) => {
      permission = v;
    },
    failSchedule: () => {
      fail = true;
    },
  };
}
test("local permission denied/blocked/unsupported never prevents using the conversation model", async () => {
  const f = await fixture();
  for (const p of ["denied", "channel-blocked", "unsupported"] as const) {
    f.setPermission(p);
    assert.equal(await f.local.send(f.event()), "denied");
    assert.equal(f.scheduled.length, 0);
    assert.ok(f.store.snapshot().identity);
  }
});
test("local send serializes duplicate concurrent calls; one native deterministic ID", async () => {
  const f = await fixture(),
    e = f.event();
  assert.deepEqual(await Promise.all([f.local.send(e), f.local.send(e)]), [
    "scheduled",
    "duplicate",
  ]);
  assert.equal(f.scheduled.length, 1);
});
test("local samples collapse by conversation while different events remain independently openable", async () => {
  const f = await fixture();
  await f.local.send(f.event());
  await f.local.send(f.event("demo-local-other"));
  assert.equal(f.scheduled[0], f.scheduled[1]);
});
test("native data is only a lookup key; fabricated events and destinations are rejected", async () => {
  const f = await fixture();
  assert.equal(await f.local.tap("https://example.invalid"), "denied");
  assert.equal(
    await f.local.tap({ eventId: "demo-local-event", route: "/admin" }),
    "invalid",
  );
  await assert.rejects(
    f.local.send({ ...f.event(), conversationId: "demo-conv-2" }),
  );
});
test("local notification opens canonical chat once even with simultaneous native responses", async () => {
  const f = await fixture();
  const e = f.event();
  await f.local.send(e);
  assert.deepEqual(
    await Promise.all([f.local.tap(e.eventId), f.local.tap(e.eventId)]),
    ["opened", "duplicate"],
  );
  assert.deepEqual(f.opened, ["demo-conv-1"]);
});
test("cold process restores journal and canonical source before opening; opened ledger survives restart", async () => {
  const f = await fixture();
  const e = f.event();
  await f.local.send(e);
  const cold = await fixture(f.storage);
  assert.equal(await cold.local.tap(e.eventId), "opened");
  await cold.store.flush();
  const third = await fixture(f.storage);
  assert.equal(await third.local.tap(e.eventId), "duplicate");
  assert.deepEqual(third.opened, []);
});
test("organization switch and logout cancel native samples and revoke destinations", async () => {
  const f = await fixture();
  const e = f.event();
  await f.local.send(e);
  f.store.identity(identity(ORG_B));
  await f.local.reconcile();
  assert.ok(f.cancelled.length);
  f.store.identity(identity());
  assert.equal(await f.local.tap(e.eventId), "denied");
  await f.local.send(f.event("demo-local-second"));
  f.store.identity(null);
  await f.local.reconcile();
  assert.equal(await f.local.tap("demo-local-second"), "denied");
});
test("account switch cannot open another users native sample", async () => {
  const f = await fixture();
  const e = f.event();
  await f.local.send(e);
  f.store.identity(identity(ORG_A, "demo-coordinator"));
  assert.equal(await f.local.tap(e.eventId), "denied");
  assert.deepEqual(f.opened, []);
});
test("expired, outgoing, wrong organization and inaccessible advisor events never schedule", async () => {
  const f = await fixture();
  for (const e of [
    f.event("demo-local-expired", {
      occurredAt: now - 200,
      expiresAt: now - 100,
    }),
    f.event("demo-local-outgoing", { kind: "message.outgoing" }),
    f.event("demo-local-b", {
      organizationId: ORG_B,
      conversationId: "demo-b-conv-1",
    }),
  ])
    await assert.rejects(f.local.send(e));
  f.store.identity(identity(ORG_A, "demo-advisor"));
  await assert.rejects(f.local.send(f.event()));
  assert.equal(f.scheduled.length, 0);
});
test("membership revoked after scheduling prevents chat opening and removes notice", async () => {
  const f = await fixture();
  const e = f.event();
  await f.local.send(e);
  f.b.setMembership(ORG_A, "demo-owner", false);
  assert.equal(await f.local.tap(e.eventId), "denied");
  await f.local.reconcile();
  assert.ok(f.cancelled.length);
});
test("permission revocation cancels notices; clear removes persisted sample authority", async () => {
  const f = await fixture();
  const e = f.event();
  await f.local.send(e);
  f.setPermission("denied");
  await f.local.permission();
  assert.equal(f.cancelled.length, 1);
  await f.local.clear();
  const cold = await fixture(f.storage);
  assert.equal(await cold.local.tap(e.eventId), "denied");
});
test("uncertain native scheduling failure retains safe retry with same identifier", async () => {
  const f = await fixture();
  const e = f.event();
  f.failSchedule();
  await assert.rejects(f.local.send(e));
  await assert.rejects(f.local.send(e));
  assert.equal(f.scheduled[0], f.scheduled[1]);
});

test("corrupt journal fails closed; existing session/conversations remain usable", async () => {
  const f = await fixture();
  await f.storage.set("dashfort.demo.local-notifications.v1", "invalid-json");
  const local = new LocalNotifications(
    f.store,
    {
      permission: async () => "granted",
      schedule: async () => {},
      cancel: async () => {},
    },
    f.storage,
    () => now,
  );
  await assert.rejects(local.hydrate());
  await assert.rejects(local.send(f.event()));
  assert.equal(f.store.snapshot().identity?.userId, "demo-owner");
  await local.clear();
  assert.equal(await local.send(f.event("demo-local-recovered")), "scheduled");
});
test("native scope is rechecked across delayed permission work", async () => {
  const f = await fixture();
  let proceed!: () => void;
  const gate = new Promise<void>((r) => {
    proceed = r;
  });
  const local = new LocalNotifications(
    f.store,
    {
      permission: async () => {
        await gate;
        return "granted";
      },
      schedule: async () => {
        throw Error("must not schedule");
      },
      cancel: async () => {},
    },
    f.storage,
    () => now,
  );
  await local.hydrate();
  const pending = local.send(f.event());
  await Promise.resolve();
  f.store.identity(null);
  proceed();
  assert.equal(await pending, "stale");
});
