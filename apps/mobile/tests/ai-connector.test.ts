import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectorStore } from "../src/features/ai-connector/core";
import { TeamRepository } from "../src/features/team/core";
import { guardedStorage } from "../src/features/team/guarded-storage";
function fixture(
  actor = "demo-owner",
  org = "demo-org-cristal",
  data = new Map<string, string>(),
) {
  const io = {
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => {
      data.set(k, v);
    },
    remove: async (k: string) => {
      data.delete(k);
    },
  };
  const team = new TeamRepository(org, io);
  let now = 1763596800000;
  const store = new ConnectorStore(team, actor, io, () => now);
  return { io, data, team, store, advance: () => (now += 86400000) };
}
const config = (
  s: ConnectorStore,
  patch: Partial<Parameters<ConnectorStore["configure"]>[0]>,
) =>
  s.configure(
    { ...s.snapshot().doc.policy, ...patch },
    s.snapshot().doc.revision,
  );
test("Connector defaults match approved policy without connections or real credentials", async () => {
  const f = fixture();
  await f.store.hydrate();
  assert.deepEqual(f.store.snapshot().doc.policy, {
    enabled: true,
    roles: ["owner", "coordinator"],
    dailyLimit: 100,
    transfer: false,
    campaign: false,
  });
  assert.equal(f.store.ownConnections().length, 0);
  assert.equal(f.store.ownActivity().length, 0);
});
test("Only owner configures and malformed/stale policies never persist", async () => {
  const f = fixture();
  await f.store.hydrate();
  const advisor = new ConnectorStore(f.team, "demo-advisor", f.io);
  await advisor.hydrate();
  await assert.rejects(config(advisor, { enabled: false }), /propietario/);
  await assert.rejects(config(f.store, { dailyLimit: 0 }));
  await assert.rejects(config(f.store, { dailyLimit: 1.5 }));
  await assert.rejects(config(f.store, { roles: ["admin" as never] }));
  await config(f.store, { dailyLimit: 2 });
  await assert.rejects(
    f.store.configure(f.store.snapshot().doc.policy, 0),
    /cambió/,
  );
});
test("Connect is explicit, repeat-safe and rename/revocation survive restoration", async () => {
  const f = fixture();
  await f.store.hydrate();
  const id = await f.store.connect("Claude", "Joe");
  assert.equal(await f.store.connect("Claude", "Joe"), id);
  await f.store.rename(id, "Nuevo nombre");
  await f.store.revoke(id);
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  assert.equal(g.store.ownConnections()[0]!.name, "Nuevo nombre");
  assert.equal(g.store.ownConnections()[0]!.active, false);
  await assert.rejects(g.store.simulate(id, "message", "one"));
  const next = await g.store.connect("Claude", "Reautorizada");
  assert.notEqual(next, id);
});
test("Personal connections and activity are isolated by actor and organization", async () => {
  const f = fixture();
  await f.store.hydrate();
  const id = await f.store.connect("Claude", "Joe");
  await f.store.simulate(id, "tag", "one");
  const c = new ConnectorStore(f.team, "demo-coordinator", f.io);
  await c.hydrate();
  assert.equal(c.ownConnections().length, 0);
  assert.equal(c.ownActivity().length, 0);
  await assert.rejects(c.rename(id, "No"));
  await assert.rejects(c.revoke(id));
  await assert.rejects(c.simulate(id, "tag", "two"));
  const g = fixture("demo-owner", "demo-org-other", f.data);
  await g.store.hydrate();
  assert.equal(g.store.ownActivity().length, 0);
  f.data.set(g.store.key, f.data.get(f.store.key)!);
  const forged = fixture("demo-owner", "demo-org-other", f.data);
  await forged.store.hydrate();
  assert.equal(forged.store.snapshot().ready, false);
});
test("Stable action receipts prevent duplicates and reject mismatched replay", async () => {
  const f = fixture();
  await f.store.hydrate();
  const id = await f.store.connect("ChatGPT", "Asistente");
  await f.store.simulate(id, "task", "one");
  await f.store.simulate(id, "task", "one");
  assert.equal(f.store.ownActivity().length, 1);
  await assert.rejects(f.store.simulate(id, "message", "one"));
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  await g.store.simulate(id, "task", "one");
  assert.equal(g.store.ownActivity().length, 1);
});
test("Daily cap is shared across providers, resets by UTC day and counts retries once", async () => {
  const f = fixture();
  await f.store.hydrate();
  await config(f.store, { dailyLimit: 1 });
  const a = await f.store.connect("Claude", "A"),
    b = await f.store.connect("ChatGPT", "B");
  await f.store.simulate(a, "task", "one");
  await assert.rejects(f.store.simulate(b, "task", "two"), /Tope/);
  await f.store.simulate(a, "task", "one");
  f.advance();
  await f.store.simulate(b, "task", "two");
  assert.equal(f.store.usedToday(), 1);
  assert.equal(f.store.ownActivity().length, 2);
});
test("Advanced functions require both organizational delegation and current role", async () => {
  const f = fixture();
  await f.store.hydrate();
  const id = await f.store.connect("Claude", "Joe");
  await assert.rejects(f.store.simulate(id, "campaign", "a"));
  await assert.rejects(f.store.simulate(id, "transfer", "b"));
  await config(f.store, {
    campaign: true,
    transfer: true,
    roles: ["owner", "coordinator", "advisor"],
  });
  await f.store.simulate(id, "campaign", "a");
  const c = new ConnectorStore(f.team, "demo-advisor", f.io);
  await c.hydrate();
  const cid = await c.connect("Claude", "Asesor");
  await c.simulate(cid, "task", "c");
  await assert.rejects(c.simulate(cid, "campaign", "d"));
  await assert.rejects(c.simulate(cid, "transfer", "e"));
});
test("Revoked connection and role change reject even a previously successful action receipt", async () => {
  const f = fixture("demo-coordinator");
  await f.store.hydrate();
  const id = await f.store.connect("Claude", "Joe");
  await f.store.simulate(id, "tag", "one");
  await f.team.update(
    "demo-owner",
    "demo-coordinator",
    { role: "owner", active: true, receiveNew: true, expected: 1 },
    "promote",
  );
  await assert.rejects(f.store.simulate(id, "tag", "one"), /reautorizar/);
  const next = await f.store.connect("Claude", "Nuevo");
  await f.store.simulate(next, "tag", "two");
  await f.store.revoke(next);
  await assert.rejects(f.store.simulate(next, "tag", "two"));
});
test("Committed policy removal blocks an open peer immediately and queued operations use latest policy", async () => {
  const f = fixture();
  await f.store.hydrate();
  const c = new ConnectorStore(f.team, "demo-coordinator", f.io);
  await c.hydrate();
  const release = f.store.retain(),
    releaseC = c.retain();
  const id = await c.connect("Claude", "Joe");
  await config(f.store, { roles: ["owner"] });
  assert.ok(c.reason(id));
  await assert.rejects(c.simulate(id, "tag", "one"));
  await assert.rejects(c.connect("ChatGPT", "No"));
  release();
  releaseC();
});
test("Concurrent configuration is detected without overwriting a successful edit", async () => {
  const f = fixture();
  await f.store.hydrate();
  const p = f.store.snapshot().doc.policy;
  const outcomes = await Promise.allSettled([
    f.store.configure({ ...p, dailyLimit: 2 }, 0),
    f.store.configure({ ...p, enabled: false }, 0),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.store.snapshot().doc.policy.dailyLimit, 2);
});
test("Failed activity save leaves no audit or consumed quota and explicit retry succeeds", async () => {
  const f = fixture();
  await f.store.hydrate();
  const id = await f.store.connect("Claude", "Joe"),
    set = f.io.set;
  f.io.set = async () => {
    throw Error("disk");
  };
  await assert.rejects(f.store.simulate(id, "task", "one"));
  assert.equal(f.store.usedToday(), 0);
  f.io.set = set;
  await f.store.simulate(id, "task", "one");
  assert.equal(f.store.usedToday(), 1);
});
test("Activity has only enum metadata and cannot restore message contents or token fields", async () => {
  const f = fixture();
  await f.store.hydrate();
  const id = await f.store.connect("Claude", "Joe");
  await f.store.simulate(id, "message", "one");
  assert.deepEqual(Object.keys(f.store.ownActivity()[0]!).sort(), [
    "actor",
    "at",
    "connection",
    "id",
    "kind",
  ]);
  const d = JSON.parse(f.data.get(f.store.key)!);
  d.activity[0].text = "Not permitted";
  f.data.set(f.store.key, JSON.stringify(d));
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  assert.equal(g.store.snapshot().ready, false);
});
test("Revocation during guarded IO rolls back a pending connection", async () => {
  const f = fixture();
  await f.team.hydrate();
  const store = new ConnectorStore(
    f.team,
    "demo-coordinator",
    guardedStorage(f.team, "demo-coordinator", f.io),
  );
  await store.hydrate();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r)),
    original = f.io.set;
  f.io.set = async (k, v) => {
    if (k === store.key) {
      entered();
      await gate;
    }
    await original(k, v);
  };
  const creating = store.connect("Claude", "Joe");
  await started;
  await f.team.update(
    "demo-owner",
    "demo-coordinator",
    { role: "coordinator", active: false, receiveNew: false, expected: 1 },
    "off",
  );
  release();
  await assert.rejects(creating);
  assert.equal(f.data.has(store.key), false);
});
