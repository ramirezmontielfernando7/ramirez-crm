import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamRepository } from "../src/features/team/core";
import { OptOutStore } from "../src/features/optout/core";
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
  const team = new TeamRepository(org, io),
    store = new OptOutStore(team, actor, io);
  return { io, data, team, store };
}
test("Optout matches full normalized text and ignores unrelated phrases", async () => {
  const f = fixture();
  await f.store.hydrate();
  await f.store.simulate("one", "demo-conv-1", "no más");
  await f.store.simulate("two", "demo-conv-1", "No más tarde");
  assert.equal(f.store.snapshot().doc.events.length, 1);
});
test("Disabled rules retain history and duplicate event is idempotent", async () => {
  const f = fixture();
  await f.store.hydrate();
  await f.store.simulate("one", "demo-conv-1", "STOP");
  await f.store.simulate("one", "demo-conv-1", "STOP");
  await f.store.enabled(false);
  await f.store.simulate("two", "demo-conv-2", "BAJA");
  assert.equal(f.store.snapshot().doc.events.length, 1);
  await assert.rejects(f.store.simulate("one", "demo-conv-2", "STOP"));
});
test("Concurrent config updates merge and survive restore", async () => {
  const f = fixture();
  await f.store.hydrate();
  await Promise.all([f.store.add("Salir"), f.store.reply("Baja ficticia")]);
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  assert.ok(g.store.snapshot().doc.words.includes("SALIR"));
  assert.equal(g.store.snapshot().doc.reply, "Baja ficticia");
});
test("Invalid config, inactive actor, advisor and foreign scope cannot persist", async () => {
  const f = fixture();
  await f.store.hydrate();
  await assert.rejects(f.store.add(""));
  await assert.rejects(f.store.reply(""));
  const a = new OptOutStore(f.team, "demo-advisor", f.io);
  await a.hydrate();
  await assert.rejects(a.enabled(false));
  await f.store.add("SALIR");
  const other = fixture("demo-owner", "demo-org-other", f.data);
  f.data.set(other.store.key, f.data.get(f.store.key)!);
  await other.store.hydrate();
  assert.equal(other.store.snapshot().ready, false);
});
test("Failed storage does not publish an executed event", async () => {
  const f = fixture();
  await f.store.hydrate();
  f.io.set = async () => {
    throw Error("disk");
  };
  await assert.rejects(f.store.simulate("one", "demo-conv-1", "STOP"));
  assert.equal(f.store.snapshot().doc.events.length, 0);
});
test("Inbox optout preserves contact identity and history metadata", async () => {
  const { InboxStore } = await import("../src/features/inbox/store-core");
  const inbox = new InboxStore({ id: "demo-owner", role: "owner" }),
    before = inbox.repository.get(inbox.actor, "demo-conv-1");
  inbox.repository.markOptOut(inbox.actor, before.id);
  const after = inbox.repository.get(inbox.actor, before.id);
  assert.equal(after.optedOut, true);
  assert.equal(after.ai, "off");
  inbox.repository.updateContact(inbox.actor, before.id, { ai: "on" });
  assert.equal(inbox.repository.get(inbox.actor, before.id).ai, "off");
  assert.equal(after.name, before.name);
  assert.equal(after.stage, before.stage);
  assert.throws(() =>
    inbox.repository.markOptOut(
      { id: "demo-advisor", role: "advisor" },
      before.id,
    ),
  );
});

test("Full ledger fails closed without silently forgetting prior optouts", async () => {
  const f = fixture();
  const doc = f.store.snapshot().doc;
  f.data.set(
    f.store.key,
    JSON.stringify({
      ...doc,
      events: Array.from({ length: 500 }, (_, i) => ({
        id: `event-${i}`,
        contact: "demo-conv-1",
        at: i,
        reply: "Baja ficticia",
      })),
    }),
  );
  await f.store.hydrate();
  await assert.rejects(
    f.store.simulate("new", "demo-conv-2", "STOP"),
    /Límite/,
  );
  assert.equal(f.store.snapshot().doc.events.length, 500);
});
test("Startup restoration can only disable sending for accessible contacts", async () => {
  const { InboxStore } = await import("../src/features/inbox/store-core");
  const inbox = new InboxStore({ id: "demo-advisor", role: "advisor" }),
    own = inbox.repository.list(inbox.actor)[0]!;
  inbox.repository.restoreOptOut(inbox.actor, [own.id, "demo-conv-999999"]);
  assert.equal(inbox.repository.get(inbox.actor, own.id).optedOut, true);
});
