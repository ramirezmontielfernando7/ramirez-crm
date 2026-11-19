import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CalendarConnectors,
  withinBusinessHours,
} from "../src/features/calendar-settings/core";
import { AgendaStore } from "../src/features/agenda/core";
function setup(
  data = new Map<string, string>(),
  role: "owner" | "coordinator" | "advisor" = "owner",
  org = "demo-org-cristal",
  io?: ReturnType<typeof port>,
) {
  const storage = io ?? port(data),
    actor = { id: `demo-${role}`, role },
    store = new CalendarConnectors(actor, org, storage),
    agenda = new AgendaStore(actor, org, storage, Date.now, store);
  return { data, storage, actor, store, agenda };
}
function port(data: Map<string, string>) {
  return {
    fail: false,
    get: async (k: string) => data.get(k) ?? null,
    set: async function (k: string, v: string) {
      if (this.fail) throw Error("disk");
      data.set(k, v);
    },
    remove: async (k: string) => {
      data.delete(k);
    },
  };
}
test("Calendar settings starts with approved fictitious Zoom on and Meet off, without writing", async () => {
  const f = setup();
  await f.store.hydrate();
  assert.equal(f.store.joinable("Zoom"), true);
  assert.equal(f.store.joinable("Meet"), false);
  assert.equal(f.store.joinable("Presencial"), false);
  assert.equal(f.data.size, 0);
});
test("Connecting a sample persists local state only; retry is idempotent", async () => {
  const f = setup();
  await f.store.hydrate();
  await f.store.set("meet", true, 0, "connect");
  await f.store.set("meet", true, 0, "connect");
  assert.equal(f.store.snapshot().doc.revision, 1);
  const g = setup(f.data);
  await g.store.hydrate();
  assert.equal(g.store.joinable("Meet"), true);
});
test("Disconnect does not cancel or mutate scheduled appointments", async () => {
  const f = setup();
  await Promise.all([f.store.hydrate(), f.agenda.hydrate()]);
  const rows = f.agenda.snapshot().rows;
  await f.store.set("zoom", false, 0, "disconnect");
  assert.equal(f.store.joinable("Zoom"), false);
  assert.deepEqual(f.agenda.snapshot().rows, rows);
});
test("Failed write retains connector and safe retry can connect once", async () => {
  const f = setup();
  await f.store.hydrate();
  f.storage.fail = true;
  await assert.rejects(f.store.set("meet", true, 0, "retry"));
  assert.equal(f.store.joinable("Meet"), false);
  f.storage.fail = false;
  await f.store.set("meet", true, 0, "retry");
  assert.equal(f.store.snapshot().doc.revision, 1);
});
test("Advisor can consult connector status but cannot alter organization settings", async () => {
  const f = setup(undefined, "advisor");
  await f.store.hydrate();
  assert.equal(f.store.joinable("Zoom"), true);
  await assert.rejects(f.store.set("meet", true, 0, "no"), /perfil/);
});
test("Coordinator edits same organization; stale dialog is rejected, not overwritten", async () => {
  const f = setup(),
    g = setup(f.data, "coordinator", "demo-org-cristal", f.storage);
  await Promise.all([f.store.hydrate(), g.store.hydrate()]);
  await f.store.set("meet", true, 0, "first");
  await assert.rejects(g.store.set("zoom", false, 0, "stale"), /cambió/);
  await g.store.reload();
  assert.equal(g.store.joinable("Meet"), true);
  await g.store.set("zoom", false, 1, "current");
  assert.equal(g.store.joinable("Zoom"), false);
});
test("Forged scope, flags and duplicate receipts fail closed without touching saved evidence", async () => {
  for (const patch of [
    { organizationId: "demo-org-other" },
    { enabled: { zoom: true, meet: "yes" } },
    { enabled: { zoom: true, meet: false, real: true } },
    {
      receipts: [
        { key: "x", provider: "meet", enabled: true },
        { key: "x", provider: "meet", enabled: true },
      ],
    },
  ]) {
    const f = setup();
    await f.store.hydrate();
    const raw = JSON.stringify({ ...f.store.snapshot().doc, ...patch });
    f.data.set(f.store.key, raw);
    await f.store.reload();
    assert.equal(f.store.snapshot().ready, false);
    assert.equal(f.store.joinable("Zoom"), false);
    assert.equal(f.data.get(f.store.key), raw);
  }
});
test("Other organizations do not inherit active connectors or receipts", async () => {
  const f = setup();
  await f.store.hydrate();
  await f.store.set("meet", true, 0, "sample");
  const g = setup(f.data, "owner", "demo-org-other");
  await g.store.hydrate();
  assert.equal(g.store.joinable("Meet"), false);
  assert.equal(g.store.snapshot().doc.receipts.length, 0);
});
test("No joinable link is advertised before reading the configuration; failed read can retry", async () => {
  const f = setup();
  assert.equal(f.store.joinable("Zoom"), false);
  const original = f.storage.get;
  f.storage.get = async () => {
    throw Error();
  };
  await f.store.hydrate();
  assert.equal(f.store.snapshot().ready, false);
  f.storage.get = original;
  await f.store.hydrate();
  assert.equal(f.store.joinable("Zoom"), true);
});
test("Idempotency key reuse cannot enable a different connector", async () => {
  const f = setup();
  await f.store.hydrate();
  await f.store.set("meet", true, 0, "one");
  await assert.rejects(f.store.set("zoom", false, 1, "one"), /otra operación/);
});
test("Business hours enforce weekdays, Saturday and closed Sunday for appointments", () => {
  assert.equal(withinBusinessHours("2026-11-19", 540, 60), true);
  assert.equal(withinBusinessHours("2026-11-19", 1080, 60), true);
  assert.equal(withinBusinessHours("2026-11-19", 1110, 60), false);
  assert.equal(withinBusinessHours("2026-11-21", 600, 60), true);
  assert.equal(withinBusinessHours("2026-11-21", 540, 60), false);
  assert.equal(withinBusinessHours("2026-11-21", 810, 60), false);
  assert.equal(withinBusinessHours("2026-11-22", 600, 30), false);
});
test("Agenda appointment candidates honor shared business hours while manual private blocks remain available", async () => {
  const f = setup();
  await f.agenda.hydrate();
  assert.deepEqual(f.agenda.available("demo-booking-b4", "2026-11-22"), []);
  assert.ok(
    f.agenda
      .available("demo-booking-b4", "2026-11-21")
      .every((t) => withinBusinessHours("2026-11-21", t, 45)),
  );
  assert.ok(f.agenda.blockSlots("2026-11-22", 30).length > 0);
});
