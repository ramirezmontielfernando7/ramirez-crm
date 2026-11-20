import assert from "node:assert/strict";
import { test } from "node:test";
import { TeamRepository } from "../src/features/team/core";
function setup(
  data = new Map<string, string>(),
  org = "demo-org-cristal",
  io?: ReturnType<typeof port>,
) {
  let now = Date.parse("2026-11-19T12:00:00Z");
  const storage = io ?? port(data),
    store = new TeamRepository(org, storage, () => now);
  return {
    data,
    storage,
    store,
    advance: () => {
      now += 8 * 86400000;
    },
  };
}
function port(data: Map<string, string>) {
  return {
    fail: false,
    get: async (k: string) => data.get(k) ?? null,
    set: async function (k: string, v: string) {
      if (this.fail) throw Error("disk");
      data.set(k, v);
    },
  };
}
const invite = {
  name: "Persona ficticia",
  email: "persona@example.test",
  role: "advisor" as const,
};
test("Team defaults match existing three fictitious identities without writing", async () => {
  const f = setup();
  await f.store.hydrate();
  assert.deepEqual(
    f.store.snapshot().doc.members.map((m) => m.id),
    ["demo-owner", "demo-coordinator", "demo-advisor"],
  );
  assert.equal(f.data.size, 0);
});
test("Invite remains pending and inactive until consumed once; same-key replay is safe", async () => {
  const f = setup();
  await f.store.hydrate();
  const id = await f.store.invite("demo-owner", invite, "one");
  assert.equal(f.store.invitationState(id), "pending");
  const member = await f.store.accept(id, "accept");
  assert.equal(await f.store.accept(id, "accept"), member);
  await assert.rejects(f.store.accept(id, "twice"), /consumida/);
  assert.equal(
    f.store.snapshot().doc.members.find((m) => m.id === member)?.active,
    true,
  );
});
test("Pending invitations expire using the clock and cannot be accepted", async () => {
  const f = setup();
  await f.store.hydrate();
  const id = await f.store.invite("demo-owner", invite, "one");
  f.advance();
  assert.equal(f.store.invitationState(id), "expired");
  await assert.rejects(f.store.accept(id, "no"), /vencida/);
});
test("Revoked invitations cannot activate a member and restore coherently", async () => {
  const f = setup();
  await f.store.hydrate();
  const id = await f.store.invite("demo-owner", invite, "one");
  await f.store.revoke("demo-owner", id, "revoke");
  const g = setup(f.data);
  await g.store.hydrate();
  assert.equal(g.store.invitationState(id), "revoked");
  await assert.rejects(g.store.accept(id, "no"), /revocada/);
});
test("Actual persisted membership controls permission, not caller-supplied role", async () => {
  const f = setup();
  await f.store.hydrate();
  for (const actor of ["demo-advisor", "demo-coordinator", "demo-unknown"])
    await assert.rejects(f.store.invite(actor, invite, actor), /propietario/);
  await f.store.update(
    "demo-owner",
    "demo-advisor",
    { role: "owner", active: true, receiveNew: false, expected: 1 },
    "promote",
  );
  await f.store.invite("demo-advisor", invite, "now-owner");
});
test("Last active owner cannot be disabled or demoted", async () => {
  const f = setup();
  await f.store.hydrate();
  await assert.rejects(
    f.store.update(
      "demo-owner",
      "demo-owner",
      { role: "advisor", active: true, receiveNew: true, expected: 1 },
      "no",
    ),
    /último/,
  );
});
test("Concurrent attempts cannot remove both owners", async () => {
  const f = setup();
  await f.store.hydrate();
  await f.store.update(
    "demo-owner",
    "demo-advisor",
    { role: "owner", active: true, receiveNew: true, expected: 1 },
    "promote",
  );
  const results = await Promise.allSettled([
    f.store.update(
      "demo-owner",
      "demo-owner",
      { role: "advisor", active: true, receiveNew: true, expected: 1 },
      "a",
    ),
    f.store.update(
      "demo-advisor",
      "demo-advisor",
      { role: "advisor", active: true, receiveNew: true, expected: 2 },
      "b",
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(
    f.store.snapshot().doc.members.filter((m) => m.active && m.role === "owner")
      .length,
    1,
  );
});
test("Concurrent duplicate invitations across instances do not produce two records", async () => {
  const f = setup(),
    g = setup(f.data, "demo-org-cristal", f.storage);
  await Promise.all([f.store.hydrate(), g.store.hydrate()]);
  const results = await Promise.allSettled([
    f.store.invite("demo-owner", invite, "a"),
    g.store.invite("demo-owner", invite, "b"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("Pending seats count toward the fake five-person plan", async () => {
  const f = setup();
  await f.store.hydrate();
  await f.store.invite("demo-owner", invite, "a");
  await f.store.invite(
    "demo-owner",
    { ...invite, email: "second@example.test" },
    "b",
  );
  await assert.rejects(
    f.store.invite(
      "demo-owner",
      { ...invite, email: "third@example.test" },
      "c",
    ),
    /cinco/,
  );
});
test("Failed write preserves roster and same-key retry creates only one invitation", async () => {
  const f = setup();
  await f.store.hydrate();
  f.storage.fail = true;
  await assert.rejects(f.store.invite("demo-owner", invite, "retry"));
  assert.equal(f.store.snapshot().doc.invitations.length, 0);
  f.storage.fail = false;
  await f.store.invite("demo-owner", invite, "retry");
  await f.store.invite("demo-owner", invite, "retry");
  assert.equal(f.store.snapshot().doc.invitations.length, 1);
});
test("Real email domains and stale member revisions are rejected", async () => {
  const f = setup();
  await f.store.hydrate();
  await assert.rejects(
    f.store.invite(
      "demo-owner",
      { ...invite, email: "person@gmail.com" },
      "mail",
    ),
    /ficticio/,
  );
  await assert.rejects(
    f.store.update(
      "demo-owner",
      "demo-advisor",
      { role: "advisor", active: false, receiveNew: false, expected: 9 },
      "stale",
    ),
    /cambió/,
  );
});
test("Other organization and forged restored scope cannot inherit invitations", async () => {
  const f = setup();
  await f.store.hydrate();
  await f.store.invite("demo-owner", invite, "a");
  const g = setup(f.data, "demo-org-other");
  await g.store.hydrate();
  assert.equal(g.store.snapshot().doc.invitations.length, 0);
  f.data.set(g.store.key, f.data.get(f.store.key)!);
  await g.store.reload();
  assert.equal(g.store.snapshot().ready, false);
});

test("Reissue invalidates previous invite and preserves member identity", async () => {
  const f = setup();
  await f.store.hydrate();
  const first = await f.store.invite("demo-owner", invite, "first");
  const second = await f.store.reissue("demo-owner", first, "renew");
  assert.notEqual(second, first);
  await assert.rejects(f.store.accept(first, "old"));
  const member = await f.store.accept(second, "new");
  assert.equal(
    f.store.snapshot().doc.invitations.find((i) => i.id === first)?.memberId,
    member,
  );
});
