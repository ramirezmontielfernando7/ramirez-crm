import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamRepository } from "../src/features/team/core";
import { PersonalStore } from "../src/features/personal/core";
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
  let now = 100;
  const store = new PersonalStore(team, actor, io, () => now);
  return { io, team, store, data, advance: () => (now += 60000) };
}
test("Personal settings default to private and unlinked", async () => {
  const f = fixture();
  await f.store.hydrate();
  assert.deepEqual(f.store.snapshot().doc.privacy, [
    false,
    false,
    false,
    false,
  ]);
  assert.equal(f.store.snapshot().doc.linked, false);
});
test("Personal privacy restores without crossing actors or organizations", async () => {
  const f = fixture();
  await f.store.hydrate();
  await f.store.setPrivacy(0, true);
  const same = fixture("demo-owner", "demo-org-cristal", f.data),
    other = fixture("demo-advisor", "demo-org-cristal", f.data),
    org = fixture("demo-owner", "demo-org-other", f.data);
  await Promise.all([
    same.store.hydrate(),
    other.store.hydrate(),
    org.store.hydrate(),
  ]);
  assert.equal(same.store.snapshot().doc.privacy[0], true);
  assert.equal(other.store.snapshot().doc.privacy[0], false);
  assert.equal(org.store.snapshot().doc.privacy[0], false);
});
test("Forged restored personal scope fails closed", async () => {
  const f = fixture();
  await f.store.hydrate();
  await f.store.setPrivacy(1, true);
  const g = fixture("demo-advisor", "demo-org-cristal", f.data);
  f.data.set(g.store.key, f.data.get(f.store.key)!);
  await g.store.hydrate();
  assert.equal(g.store.snapshot().ready, false);
});
test("Sample expires exactly at deadline and renewal permits fictitious linking", async () => {
  const f = fixture();
  await f.store.hydrate();
  f.store.renew();
  f.advance();
  await assert.rejects(f.store.link(), /caducó/);
  f.store.renew();
  await f.store.link();
  assert.equal(f.store.snapshot().doc.linked, true);
  assert.equal(f.store.expires(), 0);
  await assert.rejects(f.store.link());
});
test("Concurrent privacy changes preserve unrelated fields", async () => {
  const f = fixture();
  await f.store.hydrate();
  await Promise.all([f.store.setPrivacy(0, true), f.store.setPrivacy(3, true)]);
  assert.deepEqual(f.store.snapshot().doc.privacy, [true, false, false, true]);
});
test("Failed persistence keeps last committed preference and can retry", async () => {
  const f = fixture();
  await f.store.hydrate();
  const set = f.io.set;
  f.io.set = async () => {
    throw Error("disk");
  };
  await assert.rejects(f.store.setPrivacy(0, true));
  assert.equal(f.store.snapshot().doc.privacy[0], false);
  f.io.set = set;
  await f.store.setPrivacy(0, true);
  assert.equal(f.store.snapshot().doc.privacy[0], true);
});
test("Unknown preference and inactive identity cannot write", async () => {
  const f = fixture("demo-advisor");
  await f.store.hydrate();
  await assert.rejects(f.store.setPrivacy(4, true));
  await f.team.update(
    "demo-owner",
    "demo-advisor",
    { role: "advisor", active: false, receiveNew: false, expected: 1 },
    "off",
  );
  await assert.rejects(f.store.setPrivacy(0, true));
});

test("Personal chat needs linking, rejects real numbers and deduplicates a pair", async () => {
  const f = fixture();
  await f.store.hydrate();
  await assert.rejects(f.store.create("+525555500911"));
  await assert.rejects(f.store.create("+15550100001"));
  f.store.renew();
  await f.store.link();
  const id = await f.store.create("+15550100001");
  assert.equal(await f.store.create("+1 555 010 0001"), id);
  assert.equal(f.store.snapshot().doc.rooms?.length, 1);
  assert.equal(f.store.room(id).private, true);
});
test("Personal messages restore drafts, deduplicate and survive restart", async () => {
  const f = fixture();
  await f.store.hydrate();
  f.store.renew();
  await f.store.link();
  const id = await f.store.create("+15550100001");
  await f.store.draft(id, "Borrador");
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  assert.equal(g.store.room(id).draft, "Borrador");
  await g.store.send(id, "Hola", "send");
  await g.store.send(id, "Hola", "send");
  assert.equal(g.store.room(id).messages.length, 1);
  assert.equal(g.store.room(id).draft, "");
  await assert.rejects(g.store.send(id, "Otro", "send"));
});
test("Archived and disconnected personal rooms reject sending and preserve history", async () => {
  const f = fixture();
  await f.store.hydrate();
  f.store.renew();
  await f.store.link();
  const id = await f.store.create("+15550100001");
  await f.store.send(id, "Hola", "one");
  await f.store.archive(id, true);
  await assert.rejects(f.store.send(id, "No", "two"));
  await f.store.archive(id, false);
  await f.store.disconnect();
  await assert.rejects(f.store.send(id, "No", "three"));
  assert.equal(f.store.room(id).messages.length, 1);
});
test("Personal conversion requires explicit privacy permissions and retains personal history only", async () => {
  const f = fixture();
  await f.store.hydrate();
  f.store.renew();
  await f.store.link();
  const id = await f.store.create("+15550100001");
  await f.store.send(id, "Privado", "one");
  await assert.rejects(f.store.convert(id));
  await f.store.privacy(id, false);
  await assert.rejects(f.store.convert(id));
  await f.store.setPrivacy(0, true);
  await f.store.convert(id);
  await f.store.convert(id);
  assert.equal(f.store.room(id).client, true);
  await assert.rejects(f.store.send(id, "No", "two"));
  assert.equal(f.store.room(id).messages[0]!.text, "Privado");
});
test("Personal room access cannot cross actor or organization and concurrent sends preserve messages", async () => {
  const f = fixture();
  await f.store.hydrate();
  f.store.renew();
  await f.store.link();
  const id = await f.store.create("+15550100001");
  await Promise.all([f.store.send(id, "A", "a"), f.store.send(id, "B", "b")]);
  assert.equal(f.store.room(id).messages.length, 2);
  for (const g of [
    fixture("demo-advisor", "demo-org-cristal", f.data),
    fixture("demo-owner", "demo-org-other", f.data),
  ]) {
    await g.store.hydrate();
    assert.throws(() => g.store.room(id));
  }
});

test("Demo projection copies only authorized metadata, deduplicates and rejects another scope", async () => {
  const { InboxStore } = await import("../src/features/inbox/store-core");
  const { projectCustomer } = await import("../src/features/personal/project");
  const f = fixture();
  await f.store.hydrate();
  f.store.renew();
  await f.store.link();
  const id = await f.store.create("+15550100001"),
    inbox = new InboxStore({ id: "demo-owner", role: "owner" });
  await assert.rejects(f.store.convert(id));
  assert.throws(() => projectCustomer(inbox, f.store, id));
  await f.store.send(id, "Texto privado", "one");
  await f.store.privacy(id, false);
  await f.store.setPrivacy(0, true);
  await f.store.convert(id);
  const a = projectCustomer(inbox, f.store, id),
    b = projectCustomer(inbox, f.store, id);
  assert.equal(a.id, b.id);
  const restarted = new InboxStore({ id: "demo-owner", role: "owner" });
  restarted.create("Otro ficticio", "+15550109999");
  assert.equal(projectCustomer(restarted, f.store, id).id, a.id);
  assert.equal(a.ai, "off");
  assert.equal(a.preview.includes("Texto privado"), false);
  assert.throws(() =>
    projectCustomer(
      new InboxStore({ id: "demo-advisor", role: "advisor" }),
      f.store,
      id,
    ),
  );
  await f.store.setPrivacy(1, true);
  projectCustomer(inbox, f.store, id);
  assert.equal(inbox.repository.get(inbox.actor, a.id).ai, "on");
  await f.store.setPrivacy(1, false);
  projectCustomer(inbox, f.store, id);
  assert.equal(inbox.repository.get(inbox.actor, a.id).ai, "off");
});
