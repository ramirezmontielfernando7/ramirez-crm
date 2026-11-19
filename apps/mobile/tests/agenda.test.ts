import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AgendaStore,
  calendarCells,
  dateParts,
  weekDays,
} from "../src/features/agenda/core";
const setup = (
  role: "owner" | "coordinator" | "advisor" = "owner",
  org = "demo-org-cristal",
  memory = new Map<string, string>(),
) => {
  const storage = {
    get: async (k: string) => memory.get(k) ?? null,
    set: async (k: string, v: string) => {
      memory.set(k, v);
    },
    remove: async (k: string) => {
      memory.delete(k);
    },
  };
  return {
    store: new AgendaStore(
      { id: `demo-${role}`, role },
      org,
      storage,
      () => 1795080000000,
    ),
    storage,
    memory,
  };
};
test("Agenda lists four approved fictitious appointments by time and scopes advisor access", async () => {
  const { store } = setup();
  await store.hydrate();
  assert.deepEqual(
    store.list().map((r) => r.start),
    [600, 690, 780, 990],
  );
  const a = setup("advisor").store;
  await a.hydrate();
  assert.equal(a.list().length, 1);
  assert.throws(() => a.get("demo-booking-b4"));
  await assert.rejects(a.move("demo-booking-b4", 1, "2026-11-10", 540));
  await assert.rejects(a.cancel("demo-booking-b4", 1));
});
test("Agenda rejects overlaps for the same person but allows adjacent schedules", async () => {
  const { store } = setup();
  await store.hydrate();
  await assert.rejects(store.block("2026-11-12", 780, 60, "Duplicado"));
  await assert.rejects(store.block("2026-11-12", 825, 30, "Solapa"));
  const id = await store.block("2026-11-12", 840, 60, "Horario libre");
  assert.equal(store.get(id).start, 840);
  assert.equal(store.snapshot().saving, false);
});
test("block availability accounts for the original assignee when coordinator edits someone else's block", async () => {
  const { store } = setup("coordinator");
  await store.hydrate();
  assert.ok(
    store.blockSlots("2026-11-12", 60, "demo-booking-b3").includes(780),
  );
  assert.ok(
    !store.blockSlots("2026-11-12", 120, "demo-booking-b3").includes(900),
  );
});
test("moving updates the existing booking once, preserves duration and rejects stale versions", async () => {
  const { store } = setup();
  await store.hydrate();
  const before = store.snapshot().rows.length;
  await store.move("demo-booking-b4", 1, "2026-11-10", 630);
  const r = store.get("demo-booking-b4");
  assert.equal(r.version, 2);
  assert.equal(r.duration, 45);
  assert.equal(store.snapshot().day, "2026-11-10");
  assert.equal(store.snapshot().rows.length, before);
  await assert.rejects(store.move(r.id, 1, "2026-11-11", 540));
  await assert.rejects(store.cancel(r.id, 1));
});
test("cancellation is idempotent and cancelled/lab toggles affect visibility only", async () => {
  const { store, storage } = setup();
  await store.hydrate();
  let writes = 0;
  const set = storage.set;
  storage.set = async (k, v) => {
    writes++;
    await set(k, v);
  };
  await store.cancel("demo-booking-b4", 1);
  await store.cancel("demo-booking-b4", 1);
  assert.equal(writes, 1);
  assert.equal(store.list().length, 3);
  store.configure({ showCancelled: true });
  assert.equal(store.list().length, 5);
  assert.equal(store.list("2026-11-11").length, 0);
  store.configure({ showLab: true });
  assert.equal(store.list("2026-11-11").length, 1);
});
test("available move times exclude occupied slots and the booking's own old interval", async () => {
  const { store } = setup();
  await store.hydrate();
  assert.ok(store.available("demo-booking-b4", "2026-11-12").includes(1020));
  await store.block("2026-11-13", 540, 60, "Reservado");
  assert.ok(!store.available("demo-booking-b4", "2026-11-13").includes(540));
  assert.ok(store.availableDays("demo-booking-b4").includes("2026-11-13"));
});
test("Agenda persists locally and isolates cache by organization and user", async () => {
  const { store, memory } = setup();
  await store.hydrate();
  const id = await store.block("2026-11-13", 600, 60, "Demo");
  const restored = setup("owner", "demo-org-cristal", memory).store;
  await restored.hydrate();
  assert.equal(restored.get(id).title, "Demo");
  for (const s of [
    setup("coordinator", "demo-org-cristal", memory).store,
    setup("owner", "demo-org-other", memory).store,
  ]) {
    await s.hydrate();
    assert.throws(() => s.get(id));
  }
  const other = setup("owner", "demo-org-other", memory).store;
  memory.set(other.key, memory.get(store.key)!);
  await other.hydrate();
  assert.equal(other.snapshot().ready, false);
  assert.equal(other.snapshot().status, "error");
});
test("failed storage writes preserve the old timetable and can be retried", async () => {
  const { store, storage } = setup();
  await store.hydrate();
  const set = storage.set;
  storage.set = async () => {
    throw Error("Disk full");
  };
  await assert.rejects(store.move("demo-booking-b4", 1, "2026-11-13", 630));
  assert.equal(store.get("demo-booking-b4").version, 1);
  assert.equal(store.snapshot().saving, false);
  storage.set = set;
  await store.move("demo-booking-b4", 1, "2026-11-13", 630);
  assert.equal(store.get("demo-booking-b4").version, 2);
});
test("corrupt or overlapping restored schedules fail closed without overwriting persisted data", async () => {
  const { store, memory } = setup();
  memory.set(store.key, "{broken");
  await store.hydrate();
  assert.equal(store.snapshot().ready, false);
  await assert.rejects(store.block("2026-11-13", 600, 60, "Demo"));
  assert.equal(memory.get(store.key), "{broken");
  memory.delete(store.key);
  await store.hydrate();
  await store.block("2026-11-13", 600, 60, "Demo");
  const d = JSON.parse(memory.get(store.key)!);
  d.rows[0].assignee = "demo-owner";
  d.rows[0].start = 780;
  memory.set(store.key, JSON.stringify(d));
  const restored = setup("owner", "demo-org-cristal", memory).store;
  await restored.hydrate();
  assert.equal(restored.snapshot().ready, false);
  assert.match(restored.snapshot().error, /superpuestos/);
});
test("calendar contains November 30 and handles leap dates and boundary weeks", () => {
  const cells = calendarCells(2026, 11);
  assert.equal(cells.length, 42);
  assert.equal(cells.filter(Boolean).length, 30);
  assert.ok(cells.includes("2026-11-30"));
  assert.equal(dateParts("2024-02-29").date, 29);
  for (const d of ["2026-02-29", "2026-11-31", "2026-13-01", "bad"])
    assert.throws(() => dateParts(d));
  assert.deepEqual(weekDays("2000-01-01"), ["2000-01-01", "2000-01-02"]);
});
test("invalid time, duration and overly long block reasons cannot be persisted", async () => {
  const { store } = setup();
  await store.hydrate();
  for (const [start, duration, reason] of [
    [470, 60, "Demo"],
    [600, 15, "Demo"],
    [1190, 60, "Demo"],
    [600, 60, "x".repeat(181)],
  ] as const)
    await assert.rejects(store.block("2026-11-13", start, duration, reason));
  assert.equal(store.snapshot().rows.length, 6);
});
test("concurrent writes cannot duplicate bookings, including after restoring the same clock tick", async () => {
  const { store, memory } = setup();
  await store.hydrate();
  const jobs = await Promise.allSettled([
    store.block("2026-11-13", 600, 60, "Uno"),
    store.block("2026-11-13", 690, 60, "Dos"),
  ]);
  assert.equal(jobs.filter((j) => j.status === "fulfilled").length, 1);
  const restored = setup("owner", "demo-org-cristal", memory).store;
  await restored.hydrate();
  await restored.block("2026-11-13", 780, 60, "Tres");
  assert.equal(new Set(restored.snapshot().rows.map((r) => r.id)).size, 8);
});
test("Agenda preserves day scroll without emitting a snapshot for each scroll event", async () => {
  const { store } = setup();
  await store.hydrate();
  let calls = 0;
  store.subscribe(() => calls++);
  store.rememberOffset("2026-11-12", 432);
  store.rememberOffset("2026-11-13", 120);
  assert.equal(calls, 0);
  store.selectDay("2026-11-13");
  store.selectDay("2026-11-12");
  assert.equal(store.offset(store.snapshot().day), 432);
});
test("reentrant hydration and observer exceptions cannot strand Agenda persistence", async () => {
  const { store, storage } = setup();
  let reads = 0;
  const get = storage.get;
  storage.get = async (k) => {
    reads++;
    return get(k);
  };
  store.subscribe(() => {
    if (store.snapshot().status === "loading") void store.hydrate();
  });
  store.subscribe(() => {
    throw Error("Observer");
  });
  await store.hydrate();
  assert.equal(reads, 1);
  await store.block("2026-11-13", 600, 60, "Demo");
  assert.equal(store.snapshot().saving, false);
});
