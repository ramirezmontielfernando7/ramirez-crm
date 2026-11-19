import assert from "node:assert/strict";
import { test } from "node:test";
import { ContactDirectory } from "../src/features/contact/core";
import { WorkRepository, type WorkTask } from "../src/features/work/core";
import {
  DemoConversationRepository,
  type Actor,
} from "../src/features/inbox/model";
const owner: Actor = { id: "demo-owner", role: "owner" };
const advisor: Actor = { id: "demo-advisor", role: "advisor" };
function memory() {
  const data = new Map<string, string>();
  let fail = false,
    reads = 0,
    writes = 0;
  return {
    data,
    setFail(v: boolean) {
      fail = v;
    },
    reads: () => reads,
    writes: () => writes,
    async keys(prefix: string) {
      return [...data.keys()].filter((k) => k.startsWith(prefix));
    },
    async get(k: string) {
      reads++;
      if (fail) throw Error("disk");
      return data.get(k) ?? null;
    },
    async set(k: string, v: string) {
      writes++;
      if (fail) throw Error("disk");
      data.set(k, v);
    },
    async remove(k: string) {
      data.delete(k);
    },
  };
}
function setup(actor = owner, storage = memory()) {
  const conversations = new DemoConversationRepository();
  const dir = new ContactDirectory(
    actor,
    conversations,
    storage,
    () => {},
    () => 2_000_000_000_000,
  );
  return { dir, repo: dir.workRepo, conversations, storage };
}
const input = (contactId: string | null = "demo-conv-1") => ({
  title: "Seguimiento ficticio",
  notes: "Detalle interno",
  due: 2_000_000_000_000,
  assignee: owner.id,
  contactId,
});
test("task created in Chat is canonical in Work, Contact and Pipeline; edit and complete propagate", async () => {
  const { dir, repo } = setup(),
    c = dir.get("demo-conv-1");
  await c.hydrate();
  await c.task(
    "Cotización compartida",
    2_000_000_000_000,
    owner.id,
    "chat-task",
  );
  const t = repo.tasks()[0]!;
  assert.equal(c.snapshot().data.tasks[0]!.id, t.id);
  await repo.saveTask({ ...t, title: "Cotización revisada" });
  await repo.toggleTask(t.id);
  assert.equal(c.snapshot().data.tasks[0]!.title, "Cotización revisada");
  assert.equal(c.snapshot().data.tasks[0]!.done, true);
  assert.equal(
    c.snapshot().data.events.filter((e) => e.text.includes("Cotización"))
      .length,
    3,
  );
});
test("relink writes a single canonical document and moves both contact projections atomically", async () => {
  const { dir, repo, storage } = setup(),
    a = dir.get("demo-conv-1"),
    b = dir.get("demo-conv-2");
  await Promise.all([a.hydrate(), b.hydrate()]);
  await repo.saveTask(input());
  const t = repo.tasks()[0]!,
    writes = storage.writes();
  await repo.saveTask({ ...t, contactId: b.id });
  assert.equal(storage.writes() - writes, 1);
  assert.equal(a.snapshot().data.tasks.length, 0);
  assert.equal(b.snapshot().data.tasks.length, 1);
  assert.match(a.snapshot().data.events[0]!.text, /trasladada/);
  assert.match(b.snapshot().data.events[0]!.text, /actualizada/);
});
test("legacy tasks and internal notes import without overwriting legacy bytes; deletion never resurrects", async () => {
  const f = setup(),
    c = f.dir.get("demo-conv-1");
  await c.hydrate();
  const legacy = {
    ...c.snapshot().data,
    tasks: [
      {
        id: "old-task",
        title: "Histórica",
        due: 2_000_000_000_000,
        assignee: owner.id,
        done: false,
      },
    ],
    events: [{ id: "old-note", kind: "Nota", text: "Nota anterior", at: 1 }],
    sequence: 10,
  };
  const key = `dashfort.demo.contact.v1.${owner.id}.${c.id}`,
    raw = JSON.stringify(legacy);
  f.storage.data.set(key, raw);
  const g = setup(owner, f.storage);
  await g.repo.hydrate();
  assert.equal(g.repo.tasks()[0]!.id, "old-task");
  assert.equal(g.repo.notes()[0]!.body, "Nota anterior");
  await g.repo.removeTask("old-task", 1);
  await g.repo.removeNote("old-note", 1);
  assert.equal(f.storage.data.get(key), raw);
  const h = setup(owner, f.storage);
  await h.repo.hydrate();
  assert.equal(h.repo.tasks().length, 0);
  assert.equal(h.repo.notes().length, 0);
});
test("persistent operation receipts deduplicate after restoration and reject payload reuse", async () => {
  const f = setup();
  await f.repo.hydrate();
  await f.repo.saveTask(input(), "once");
  const g = setup(owner, f.storage);
  await g.repo.hydrate();
  await g.repo.saveTask(input(), "once");
  assert.equal(g.repo.tasks().length, 1);
  await assert.rejects(
    async () => g.repo.saveTask({ ...input(), title: "Otro" }, "once"),
    /identificador/,
  );
});
test("failed writes preserve projections and allow retry without duplicate tasks", async () => {
  const f = setup();
  await f.repo.hydrate();
  const before = f.repo.snapshot().doc;
  f.storage.setFail(true);
  await assert.rejects(f.repo.saveTask(input(), "retry"), /disk/);
  assert.equal(f.repo.snapshot().doc, before);
  f.storage.setFail(false);
  await f.repo.saveTask(input(), "retry");
  assert.equal(f.repo.tasks().length, 1);
});
test("stale task and note editors cannot overwrite newer revisions", async () => {
  const { repo } = setup();
  await repo.hydrate();
  await repo.saveTask(input());
  const t = repo.tasks()[0]!;
  await repo.toggleTask(t.id);
  await assert.rejects(repo.saveTask({ ...t, title: "Stale" }), /cambió/);
  await repo.saveNote({
    title: "Idea",
    body: "Interna",
    color: "am",
    pin: false,
    contactId: null,
  });
  const n = repo.notes()[0]!;
  await repo.saveNote({ ...n, pin: true });
  await assert.rejects(repo.removeNote(n.id, n.revision), /cambió/);
});
test("advisor reads own tasks only and cannot assign or link inaccessible contacts", async () => {
  const { repo } = setup(advisor);
  await repo.hydrate();
  repo.fixtures();
  assert.ok(repo.tasks(true).every((t) => t.assignee === advisor.id));
  await assert.rejects(
    repo.saveTask({ ...input(null), assignee: owner.id }),
    /perfil/,
  );
  await assert.rejects(
    repo.saveTask({ ...input("demo-conv-1"), assignee: advisor.id }),
  );
  await repo.saveTask({ ...input("demo-conv-3"), assignee: advisor.id });
});
test("revocation during a storage write rolls back old and new contact links", async () => {
  const f = setup(advisor);
  await f.repo.hydrate();
  await f.repo.saveTask({ ...input("demo-conv-3"), assignee: advisor.id });
  const t = f.repo.tasks()[0]!,
    old = f.repo.snapshot().doc,
    original = f.storage.set;
  let first = true;
  f.storage.set = async (k, v) => {
    await original(k, v);
    if (first) {
      first = false;
      f.conversations.updateContact(owner, "demo-conv-3", {
        assigned: owner.id,
      });
    }
  };
  await assert.rejects(f.repo.saveTask({ ...t, contactId: null }));
  assert.equal(f.repo.snapshot().doc, old);
  assert.equal(
    JSON.parse(f.storage.data.get(f.repo.key)!).tasks[0].contactId,
    "demo-conv-3",
  );
});
test("failed rollback quarantines further writes until explicit reload", async () => {
  const f = setup(advisor);
  await f.repo.hydrate();
  const original = f.storage.set;
  let first = true;
  f.storage.set = async (k, v) => {
    if (!first) throw Error("rollback disk");
    await original(k, v);
    first = false;
    f.conversations.updateContact(owner, "demo-conv-3", { assigned: owner.id });
  };
  await assert.rejects(
    f.repo.saveTask({ ...input("demo-conv-3"), assignee: advisor.id }),
  );
  assert.equal(f.repo.snapshot().ready, false);
  await assert.rejects(
    f.repo.saveTask({ ...input(null), assignee: advisor.id }),
    /cargue/,
  );
});
test("notes are internal timeline events, never messages or conversation preview updates", async () => {
  const { repo, dir, conversations } = setup(),
    c = dir.get("demo-conv-1");
  await c.hydrate();
  const conversation = conversations.get(owner, c.id);
  await repo.saveNote({
    title: "Precios",
    body: "No enviar al cliente",
    color: "ve",
    pin: true,
    contactId: c.id,
  });
  assert.equal(conversations.get(owner, c.id), conversation);
  assert.equal(c.snapshot().data.events[0]!.kind, "Nota");
  assert.equal(c.snapshot().data.events[0]!.text, "No enviar al cliente");
});
test("metadata changes do not overwrite canonical tasks and events", async () => {
  const { repo, dir } = setup(),
    c = dir.get("demo-conv-1");
  await c.hydrate();
  await repo.saveTask(input());
  await c.stage("Cliente");
  await c.sale(25000, "Media");
  assert.equal(repo.tasks().length, 1);
  assert.equal(c.snapshot().data.tasks.length, 1);
  assert.ok(
    c
      .snapshot()
      .data.events.some((e) => e.text.includes("Seguimiento ficticio")),
  );
});
test("only current actor legacy keys are read and other organization documents fail closed", async () => {
  const f = setup();
  f.storage.data.set(
    "dashfort.demo.contact.v1.demo-advisor.demo-conv-3",
    "private bytes",
  );
  await f.repo.hydrate();
  assert.equal(f.storage.reads(), 1);
  await f.repo.saveTask(input());
  const d = JSON.parse(f.storage.data.get(f.repo.key)!);
  d.organizationId = "demo-org-other";
  f.storage.data.set(f.repo.key, JSON.stringify(d));
  const g = setup(owner, f.storage);
  await g.repo.hydrate();
  assert.equal(g.repo.snapshot().ready, false);
  assert.equal(g.repo.tasks().length, 0);
});
test("reentrant and throwing subscribers cannot duplicate or interrupt queued work", async () => {
  const { repo } = setup();
  await repo.hydrate();
  let triggered = false,
    second: Promise<void> | undefined;
  repo.subscribe(() => {
    if (repo.snapshot().saving && !triggered) {
      triggered = true;
      second = repo.saveTask({ ...input(null), title: "Segunda" }, "two");
    }
  });
  repo.subscribe(() => {
    throw Error("observer");
  });
  await repo.saveTask(input(), "one");
  await second;
  assert.equal(repo.tasks().length, 2);
  assert.equal(repo.snapshot().saving, false);
});
test("fixtures survive restart without resurrecting a deleted fixture", async () => {
  const f = setup();
  await f.repo.hydrate();
  f.repo.fixtures();
  await f.repo.removeTask("demo-work-task-1", 1);
  const g = setup(owner, f.storage);
  await g.repo.hydrate();
  g.repo.fixtures();
  assert.ok(!g.repo.tasks(true).some((t) => t.id === "demo-work-task-1"));
});
test("corrupted local sequence and failed reads do not overwrite evidence", async () => {
  const f = setup();
  await f.repo.hydrate();
  await f.repo.saveTask(input());
  const raw = f.storage.data.get(f.repo.key)!;
  const d = JSON.parse(raw);
  d.sequence = 0;
  f.storage.data.set(f.repo.key, JSON.stringify(d));
  const g = setup(owner, f.storage);
  await g.repo.hydrate();
  assert.equal(g.repo.snapshot().ready, false);
  assert.match(g.repo.snapshot().error, /Secuencia/);
  f.storage.setFail(true);
  const h = setup(owner, f.storage);
  await h.repo.hydrate();
  assert.equal(h.repo.snapshot().ready, false);
  assert.equal(h.storage.writes(), f.storage.writes());
});
test("5000 task cap and virtual-list source avoid a write beyond capacity", async () => {
  const f = setup();
  await f.repo.hydrate();
  await f.repo.saveTask(input(null));
  const d = JSON.parse(f.storage.data.get(f.repo.key)!);
  d.sequence = 5001;
  d.tasks = Array.from({ length: 5000 }, (_, i) => ({
    ...d.tasks[0],
    id: `large-${i}`,
  }));
  f.storage.data.set(f.repo.key, JSON.stringify(d));
  const g = setup(owner, f.storage);
  await g.repo.hydrate();
  assert.equal(g.repo.tasks().length, 5000);
  await assert.rejects(g.repo.saveTask(input(null)), /válidos/);
  assert.equal(g.repo.tasks().length, 5000);
});
test("delete receipts are replay-safe after deletion and restart", async () => {
  const f = setup();
  await f.repo.hydrate();
  await f.repo.saveTask(input());
  const t = f.repo.tasks()[0]!;
  await f.repo.removeTask(t.id, t.revision, "delete-once");
  const g = setup(owner, f.storage);
  await g.repo.hydrate();
  await g.repo.removeTask(t.id, t.revision, "delete-once");
  assert.equal(g.repo.tasks().length, 0);
});
test("queued payloads are immutable and concurrent identical operation IDs write once", async () => {
  const f = setup();
  await f.repo.hydrate();
  const data = input();
  const a = f.repo.saveTask(data, "frozen");
  data.title = "Changed after submit";
  await a;
  assert.equal(f.repo.tasks()[0]!.title, "Seguimiento ficticio");
  await Promise.all([
    f.repo.saveTask(input(null), "same"),
    f.repo.saveTask(input(null), "same"),
  ]);
  assert.equal(f.repo.tasks().length, 2);
});
test("invalid note colors, impossible timestamps and unknown assignees cannot persist", async () => {
  const f = setup();
  await f.repo.hydrate();
  await assert.rejects(f.repo.saveTask({ ...input(), due: 1e30 }));
  await assert.rejects(
    f.repo.saveTask({ ...input(), assignee: "inactive-sofia" }),
  );
  await assert.rejects(
    f.repo.saveNote({
      title: "",
      body: " ",
      color: "am",
      pin: false,
      contactId: null,
    }),
  );
  await assert.rejects(
    f.repo.saveNote({
      title: "",
      body: "Valid",
      color: "bad" as never,
      pin: false,
      contactId: null,
    }),
  );
  assert.equal(f.storage.writes(), 0);
});
