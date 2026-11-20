import assert from "node:assert/strict";
import { test } from "node:test";
import { TeamRepository } from "../src/features/team/core";
import { guardedStorage } from "../src/features/team/guarded-storage";
function setup() {
  const data = new Map<string, string>([["draft", "before"]]);
  const io = {
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => {
      data.set(k, v);
    },
    remove: async (k: string) => {
      data.delete(k);
    },
  };
  const team = new TeamRepository("demo-org-cristal", io);
  return { data, io, team };
}
test("Retired storage instance rejects writes after demotion even when its model cached the owner role", async () => {
  const f = setup();
  await f.team.hydrate();
  const port = guardedStorage(f.team, "demo-owner", f.io);
  await f.team.update(
    "demo-owner",
    "demo-advisor",
    { role: "owner", active: true, receiveNew: true, expected: 1 },
    "promote",
  );
  await f.team.update(
    "demo-owner",
    "demo-owner",
    { role: "advisor", active: true, receiveNew: true, expected: 1 },
    "demote",
  );
  await assert.rejects(port.set("draft", "after"), /permisos/);
  assert.equal(f.data.get("draft"), "before");
});
test("Revocation during storage await restores previous bytes and cannot report success", async () => {
  const f = setup();
  await f.team.hydrate();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    entered = new Promise<void>((r) => (started = r)),
    original = f.io.set;
  let hold = true;
  f.io.set = async (k, v) => {
    if (k === "draft" && hold) {
      hold = false;
      started();
      await gate;
    }
    await original(k, v);
  };
  const port = guardedStorage(f.team, "demo-advisor", f.io),
    job = port.set("draft", "after");
  await entered;
  await f.team.update(
    "demo-owner",
    "demo-advisor",
    { role: "advisor", active: false, receiveNew: false, expected: 1 },
    "off",
  );
  release();
  await assert.rejects(job, /desactivado/);
  assert.equal(f.data.get("draft"), "before");
});
test("Failed rollback quarantines the affected writer instead of continuing with uncertain data", async () => {
  const f = setup();
  await f.team.hydrate();
  const port = guardedStorage(f.team, "demo-owner", f.io);
  f.io.set = async () => {
    f.data.set("draft", "partial");
    throw Error("disk");
  };
  await assert.rejects(port.set("draft", "after"));
  await assert.rejects(port.set("draft", "again"), /cuarentena/);
});
test("Unrelated roster change does not revoke unchanged actor's authority", async () => {
  const f = setup();
  await f.team.hydrate();
  const port = guardedStorage(f.team, "demo-owner", f.io);
  await f.team.invite(
    "demo-owner",
    { name: "Ejemplo", email: "test@example.test", role: "advisor" },
    "invite",
  );
  await port.set("draft", "after");
  assert.equal(f.data.get("draft"), "after");
});
test("Fake reset records a local outcome without credential or token fields and survives restoration", async () => {
  const f = setup();
  await f.team.hydrate();
  await f.team.resetAccess("demo-owner", "demo-advisor", "reset");
  await f.team.resetAccess("demo-owner", "demo-advisor", "reset");
  const next = new TeamRepository("demo-org-cristal", f.io);
  await next.hydrate();
  assert.equal(
    next.snapshot().doc.members.find((m) => m.id === "demo-advisor")
      ?.resetCount,
    1,
  );
  assert.equal(JSON.stringify(next.snapshot().doc).includes("password"), false);
});
test("Lab expiration is local, reissue invalidates previous invitation, acceptance keeps member identity", async () => {
  const f = setup();
  await f.team.hydrate();
  const first = await f.team.invite(
    "demo-owner",
    { name: "Ejemplo", email: "test@example.test", role: "advisor" },
    "invite",
  );
  await f.team.expireDemo("demo-owner", first, "expire");
  assert.equal(f.team.invitationState(first), "expired");
  const second = await f.team.reissue("demo-owner", first, "reissue");
  await assert.rejects(f.team.accept(first, "old"));
  await f.team.accept(second, "new");
  assert.equal(f.team.seats(), 4);
});
