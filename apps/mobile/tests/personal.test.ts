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
