import assert from "node:assert/strict";
import { test } from "node:test";
import { NoticeStore, noticeRows } from "../src/features/notices/core";
import { ContactDirectory } from "../src/features/contact/core";
import { DemoConversationRepository } from "../src/features/inbox/model";
import { AgendaStore } from "../src/features/agenda/core";
import { LibraryStore } from "../src/features/library/core";
import { StudioStore } from "../src/features/studio/core";
const now = Date.parse("2026-11-19T17:00:00Z");
function setup(
  data = new Map<string, string>(),
  role: "owner" | "coordinator" | "advisor" = "owner",
  org = "demo-org-cristal",
) {
  let fail = false;
  const actor = { id: `demo-${role}`, role },
    storage = {
      get: async (k: string) => data.get(k) ?? null,
      set: async (k: string, v: string) => {
        if (fail) throw Error("disk");
        data.set(k, v);
      },
      remove: async (k: string) => {
        data.delete(k);
      },
    };
  const repo = new DemoConversationRepository(),
    dir = new ContactDirectory(
      actor,
      repo,
      storage,
      () => {},
      () => now,
    ),
    work = dir.workRepo,
    agenda = new AgendaStore(actor, org, storage),
    library = new LibraryStore(actor, org, storage),
    studio = new StudioStore(library, repo, () => now),
    store = new NoticeStore(actor, org, storage);
  return {
    data,
    repo,
    work,
    agenda,
    library,
    studio,
    store,
    storage,
    fail: (v: boolean) => {
      fail = v;
    },
    rows: () =>
      noticeRows(
        store,
        repo,
        work,
        agenda,
        role === "owner" ? studio : null,
        now,
      ),
    ready: async () => {
      await Promise.all([
        store.hydrate(),
        work.hydrate(),
        agenda.hydrate(),
        library.hydrate(),
      ]);
      await work.fixtures();
    },
  };
}
test("Notices project canonical handoff/tasks/appointments, not independent duplicated objects", async () => {
  const f = setup();
  await f.ready();
  const rows = f.rows();
  assert.ok(rows.some((r) => r.kind === "handoff"));
  assert.ok(rows.some((r) => r.kind === "task"));
  assert.ok(rows.some((r) => r.kind === "appointment"));
  assert.equal(
    rows.some((r) => r.kind === "usage"),
    false,
  );
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
});
test("Handoff and reminder preferences immediately filter in-app notices", async () => {
  const f = setup();
  await f.ready();
  await f.store.preference("handoff", false);
  assert.equal(
    f.rows().some((r) => r.kind === "handoff"),
    false,
  );
  await f.store.preference("reminders", false);
  assert.equal(f.rows().length, 0);
  await f.store.preference("handoff", true);
  assert.ok(f.rows().length);
});
test("Sound is a persisted app preference and cannot enable remote push", async () => {
  const f = setup();
  await f.ready();
  await f.store.preference("sound", false);
  await assert.rejects(f.store.preference("push", true), /desactivado/);
  const g = setup(f.data);
  await g.ready();
  assert.equal(g.store.snapshot().doc.preferences.sound, false);
  assert.equal(g.store.snapshot().doc.preferences.push, false);
});
test("Failed preference save preserves previous value and retry works", async () => {
  const f = setup();
  await f.ready();
  f.fail(true);
  await assert.rejects(f.store.preference("handoff", false));
  assert.equal(f.store.snapshot().doc.preferences.handoff, true);
  f.fail(false);
  await f.store.preference("handoff", false);
  assert.equal(f.store.snapshot().doc.preferences.handoff, false);
});
test("Concurrent preference writes merge without losing unrelated choices", async () => {
  const f = setup();
  await f.ready();
  await Promise.all([
    f.store.preference("sound", false),
    f.store.preference("handoff", false),
    f.store.preference("reminders", false),
  ]);
  assert.deepEqual(f.store.snapshot().doc.preferences, {
    sound: false,
    handoff: false,
    reminders: false,
    push: false,
  });
});
test("Read markers persist independently of source data and deduplicate", async () => {
  const f = setup();
  await f.ready();
  const row = f.rows()[0]!;
  await Promise.all([f.store.markRead(row.id), f.store.markRead(row.id)]);
  const g = setup(f.data);
  await g.ready();
  assert.deepEqual(g.store.snapshot().doc.read, [row.id]);
  assert.equal(f.repo.get(f.store.actor, "demo-conv-1").ai, "pause");
});
test("Failed read marker does not report read or mutate sources", async () => {
  const f = setup();
  await f.ready();
  f.fail(true);
  await assert.rejects(f.store.markRead(f.rows()[0]!.id));
  assert.equal(f.store.snapshot().doc.read.length, 0);
});
test("Quota notice derives from Studio and stays owner-only", async () => {
  const f = setup();
  await f.ready();
  await f.studio.usageScenario("warning");
  assert.equal(
    f.rows().find((r) => r.kind === "usage")?.title,
    "Llegaste al 80 % de tu IA del mes",
  );
  const g = setup(f.data, "coordinator");
  await g.ready();
  assert.equal(
    g.rows().some((r) => r.kind === "usage"),
    false,
  );
});
test("Advisor receives no handoff, tasks or appointments assigned to other actors", async () => {
  const f = setup(undefined, "advisor");
  await f.ready();
  for (const row of f.rows()) {
    if (row.kind === "handoff")
      assert.equal(
        f.repo.get(f.store.actor, row.target.split("/").pop()!).assigned,
        "demo-advisor",
      );
    if (row.kind === "task")
      assert.equal(
        f.work.getTask(decodeURIComponent(row.target.split("=")[1]!)).assignee,
        "demo-advisor",
      );
    if (row.kind === "appointment")
      assert.equal(
        f.agenda.get(decodeURIComponent(row.target.split("=")[1]!)).assignee,
        "demo-advisor",
      );
  }
  assert.equal(
    f.rows().some((r) => r.kind === "usage"),
    false,
  );
});
test("Archived chat disappears immediately and read marker cannot recreate it", async () => {
  const f = setup();
  await f.ready();
  const row = f.rows().find((r) => r.kind === "handoff")!;
  await f.store.markRead(row.id);
  f.repo.archive(f.store.actor, [row.target.split("/").pop()!]);
  assert.equal(
    f.rows().some((r) => r.id === row.id),
    false,
  );
});
test("Finishing an actual task removes its notice instead of maintaining a stale copy", async () => {
  const f = setup();
  await f.ready();
  const row = f.rows().find((r) => r.kind === "task")!,
    id = decodeURIComponent(row.target.split("=")[1]!);
  await f.work.toggleTask(id);
  assert.equal(
    f.rows().some((r) => r.id === row.id),
    false,
  );
});
test("Preferences and read markers are isolated across actors and organizations", async () => {
  const f = setup();
  await f.ready();
  await f.store.preference("reminders", false);
  await f.store.markRead(f.rows()[0]!.id);
  for (const g of [
    setup(f.data, "coordinator"),
    setup(f.data, "owner", "demo-org-other"),
  ]) {
    await g.store.hydrate();
    assert.equal(g.store.snapshot().doc.preferences.reminders, true);
    assert.equal(g.store.snapshot().doc.read.length, 0);
  }
});
test("Cross-scope source repositories fail closed", async () => {
  const f = setup();
  await f.ready();
  const g = setup(f.data, "advisor");
  await g.ready();
  assert.deepEqual(
    noticeRows(g.store, f.repo, f.work, f.agenda, f.studio, now),
    [],
  );
});
test("Forged scope, malformed preferences, read IDs and push=true fail closed without overwrite", async () => {
  for (const patch of [
    { userId: "demo-other" },
    { organizationId: "demo-org-other" },
    {
      preferences: { sound: true, handoff: true, reminders: true, push: true },
    },
    { read: ["https://example.invalid"] },
    { read: ["demo-notice-x", "demo-notice-x"] },
  ]) {
    const f = setup();
    await f.ready();
    const raw = JSON.stringify({ ...f.store.snapshot().doc, ...patch });
    f.data.set(f.store.key, raw);
    const g = setup(f.data);
    await g.store.hydrate();
    assert.equal(g.store.snapshot().ready, false);
    assert.ok(g.store.snapshot().error);
    assert.equal(f.data.get(f.store.key), raw);
  }
});
test("Read ledger is bounded and invalid targets rejected", async () => {
  const f = setup();
  await f.ready();
  for (let i = 0; i < 305; i++) await f.store.markRead(`demo-notice-${i}`);
  assert.equal(f.store.snapshot().doc.read.length, 300);
  assert.equal(f.store.snapshot().doc.read[0], "demo-notice-5");
  await assert.rejects(f.store.markRead("javascript:bad"));
});

test("Legacy task IDs containing delimiters produce safe distinct read IDs and encoded internal destinations", async () => {
  const f = setup();
  await f.ready();
  const raw = JSON.parse(
    f.data.get(f.work.key) ?? JSON.stringify(f.work.snapshot().doc),
  );
  raw.tasks = [
    {
      ...f.work.tasks(true)[0],
      id: "demo-conv-1:task:9 &?",
      done: false,
      due: now - 1000,
    },
  ];
  f.data.set(f.work.key, JSON.stringify(raw));
  const g = setup(f.data);
  await g.ready();
  const row = g.rows().find((r) => r.kind === "task")!;
  assert.equal(
    decodeURIComponent(row.target.split("=")[1]!),
    "demo-conv-1:task:9 &?",
  );
  await g.store.markRead(row.id);
  assert.ok(g.store.snapshot().doc.read.includes(row.id));
});
