import assert from "node:assert/strict";
import { test } from "node:test";
import { LibraryStore } from "../src/features/library/core";
import { StudioStore } from "../src/features/studio/core";
import { DemoConversationRepository } from "../src/features/inbox/model";
import { seedStudio, validateStudio } from "../src/features/studio/model";
function setup(
  role: "owner" | "coordinator" | "advisor" = "owner",
  data = new Map<string, string>(),
  org = "demo-org-cristal",
) {
  let fail = false,
    writes = 0;
  const storage = {
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => {
      writes++;
      if (fail) throw Error("disk");
      data.set(k, v);
    },
    remove: async (k: string) => {
      data.delete(k);
    },
  };
  const library = new LibraryStore({ id: `demo-${role}`, role }, org, storage),
    conversations = new DemoConversationRepository();
  return {
    library,
    store: new StudioStore(library, conversations, () => 2_000_000_000_000),
    conversations,
    data,
    storage,
    fail: (v: boolean) => {
      fail = v;
    },
    writes: () => writes,
  };
}
test("seed IDs reuse Knowledge readers and one published general", async () => {
  const f = setup();
  await f.library.hydrate();
  assert.deepEqual(
    f.library.readers().map((r) => r.id),
    ["demo-agent-a1", "demo-agent-a2"],
  );
  assert.equal(f.store.list().filter((a) => a.general).length, 1);
  assert.equal(f.store.get("demo-agent-a3").versions.length, 0);
});
test("owner-only Studio reads and mutations reject coordinator/advisor", async () => {
  for (const role of ["coordinator", "advisor"] as const) {
    const f = setup(role);
    await f.library.hydrate();
    for (const fn of [
      () => f.store.doc(),
      () => f.store.list(),
      () => f.store.get("demo-agent-a1"),
      () => f.store.create(),
      () => f.store.preview("demo-agent-a1", "Hola"),
    ])
      assert.throws(fn, /perfil/);
    assert.equal(f.writes(), 0);
  }
});
test("blank creation persists once and restores from the same organization/user document", async () => {
  const f = setup();
  await f.library.hydrate();
  const id = await f.store.create("Agente demo", "new-once");
  const g = setup("owner", f.data);
  await g.library.hydrate();
  assert.equal(await g.store.create("Agente demo", "new-once"), id);
  assert.equal(g.store.list().length, 4);
  assert.equal(g.store.get(id!).versions.length, 0);
});
test("creator makes one draft and following requests change only that draft", async () => {
  const f = setup();
  await f.library.hydrate();
  const id = await f.store.creator("Tengo una joyería", "creator-first");
  assert.equal(f.store.get(id!).versions.length, 0);
  await f.store.creator("Hazlo más formal", "creator-formal");
  assert.match(f.store.get(id!).draft.tone, /Formal/);
  assert.equal(f.store.list().length, 4);
  assert.equal(f.store.doc().creator.turns.length, 2);
  await f.store.creator("Hazlo más formal", "creator-formal");
  assert.equal(f.store.doc().creator.turns.length, 2);
});
test("failed creator request preserves transcript and is safely retryable", async () => {
  const f = setup();
  await f.library.hydrate();
  f.fail(true);
  await assert.rejects(f.store.creator("Joyería", "retry"));
  assert.equal(f.store.doc().creator.turns.length, 0);
  f.fail(false);
  await f.store.creator("Joyería", "retry");
  assert.equal(f.store.doc().creator.turns.length, 1);
});
test("draft autosave leaves published version byte-for-byte unchanged", async () => {
  const f = setup();
  await f.library.hydrate();
  const a = f.store.get("demo-agent-a1"),
    published = JSON.stringify(a.versions);
  f.store.edit(a.id, { greeting: "Nuevo saludo" });
  assert.equal(f.store.config(a.id).greeting, "Nuevo saludo");
  assert.equal(f.store.get(a.id).draft.greeting, a.draft.greeting);
  await f.store.flush(a.id);
  assert.equal(f.store.get(a.id).draft.greeting, "Nuevo saludo");
  assert.equal(JSON.stringify(f.store.get(a.id).versions), published);
  assert.equal(f.store.dirty(a.id), false);
});
test("typing during slow storage cannot erase a newer buffer and flushes latest text", async () => {
  const f = setup();
  await f.library.hydrate();
  let release!: () => void, entered!: () => void;
  const inside = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r)),
    set = f.storage.set;
  let first = true;
  f.storage.set = async (k, v) => {
    if (first) {
      first = false;
      entered();
      await gate;
    }
    await set(k, v);
  };
  const id = "demo-agent-a1";
  f.store.edit(id, { greeting: "Primero" });
  const a = f.store.flush(id);
  await inside;
  f.store.edit(id, { greeting: "Segundo" });
  const b = f.store.flush(id);
  release();
  await Promise.all([a, b]);
  assert.equal(f.store.get(id).draft.greeting, "Segundo");
  assert.equal(f.store.dirty(id), false);
});
test("failed draft write retains buffer for retry rather than publishing or discarding", async () => {
  const f = setup();
  await f.library.hydrate();
  const id = "demo-agent-a1";
  f.store.edit(id, { tone: "Formal" });
  f.fail(true);
  await assert.rejects(f.store.flush(id));
  assert.equal(f.store.config(id).tone, "Formal");
  assert.equal(f.store.get(id).draft.tone, "Cercano y directo");
  f.fail(false);
  await f.store.flush(id);
  assert.equal(f.store.get(id).draft.tone, "Formal");
});
test("preview is stateless, uses indexed allowed sources and never touches chats or storage", async () => {
  const f = setup();
  await f.library.hydrate();
  const before = f.store.doc(),
    chat = f.conversations.list(f.library.actor),
    writes = f.writes();
  const r = f.store.preview("demo-agent-a1", "¿Tienen anillos?");
  assert.equal(r.model, "Simulador local");
  assert.ok(r.knowledge.includes("Catálogo mayoreo 2026.pdf"));
  assert.equal(f.store.doc(), before);
  assert.equal(f.writes(), writes);
  assert.equal(f.conversations.list(f.library.actor)[0], chat[0]);
});
test("exclusive knowledge is shown to intended agent; disabled shared knowledge excludes common sources", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.library.uploadKnowledge(
    { name: "Exclusivo.pdf", kind: "pdf", bytes: 1000 },
    "General",
    "demo-agent-a2",
    true,
  );
  await f.library.finishKnowledge();
  f.store.edit("demo-agent-a2", { sharedKnowledge: false });
  const r = f.store.preview("demo-agent-a2", "Hola");
  assert.deepEqual(r.knowledge, ["Exclusivo.pdf"]);
  assert.ok(
    !f.store
      .preview("demo-agent-a1", "Hola")
      .knowledge.includes("Exclusivo.pdf"),
  );
});
test("internal rename immediately updates reader labels without changing public display name", async () => {
  const f = setup();
  await f.library.hydrate();
  const a = f.store.get("demo-agent-a2");
  await f.store.rename(a.id, a.revision, "Agenda renombrada");
  assert.equal(f.library.readerLabel(a.id), "Agenda renombrada");
  assert.equal(f.store.get(a.id).draft.displayName, a.draft.displayName);
});
test("archive moves exclusive sources and removes assignments in exactly one write", async () => {
  const f = setup();
  await f.library.hydrate();
  const id = "demo-agent-a2";
  await f.library.uploadKnowledge(
    { name: "Exclusivo.pdf", kind: "pdf", bytes: 1000 },
    "Ventas",
    id,
    true,
  );
  const writes = f.writes(),
    a = f.store.get(id);
  await f.store.archive(id, a.revision, "general");
  assert.equal(f.writes() - writes, 1);
  assert.throws(() => f.store.get(id));
  assert.ok(!Object.values(f.store.doc().assignments).includes(id));
  const e = f.library
    .snapshot()
    .entries.find((e) => e.title === "Exclusivo.pdf")!;
  assert.equal(e.knowledge!.reader, null);
  assert.equal(e.knowledge!.group, "General");
  assert.ok(!f.library.readers().some((r) => r.id === id));
});
test("failed atomic archive leaves agent, exclusive document and assignments intact", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.library.uploadKnowledge(
    { name: "X.pdf", kind: "pdf", bytes: 10 },
    "General",
    "demo-agent-a2",
    true,
  );
  const before = f.library.snapshot();
  f.fail(true);
  await assert.rejects(f.store.archive("demo-agent-a2", 1, "delete"));
  assert.equal(f.library.snapshot().studio, before.studio);
  assert.equal(f.library.snapshot().entries, before.entries);
});
test("archive delete policy preserves Chat files and removes IA-only entries", async () => {
  const f = setup();
  await f.library.hydrate();
  const cat = f.library.get("demo-library-catalog");
  await f.library.save({
    ...cat,
    expectedVersion: cat.version,
    knowledge: { ...f.library.knowledgeInfo(cat), reader: "demo-agent-a2" },
  });
  const id = await f.library.uploadKnowledge(
    { name: "Exclusivo.pdf", kind: "pdf", bytes: 10 },
    "General",
    "demo-agent-a2",
    true,
  );
  await f.store.archive("demo-agent-a2", 1, "delete");
  assert.equal(f.library.get(cat.id).chat, true);
  assert.equal(f.library.get(cat.id).rag, false);
  assert.throws(() => f.library.knowledgeGet(id));
});
test("general agent cannot be archived and general shared knowledge cannot be disabled", async () => {
  const f = setup();
  await f.library.hydrate();
  await assert.rejects(
    f.store.archive("demo-agent-a1", 1, "general"),
    /general/,
  );
  assert.throws(
    () => f.store.edit("demo-agent-a1", { sharedKnowledge: false }),
    /general/,
  );
  assert.equal(f.store.list().length, 3);
});
test("stale editor and duplicate operation identifiers cannot overwrite current agent", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.rename("demo-agent-a2", 1, "Primero", "rename-once");
  await assert.rejects(
    f.store.rename("demo-agent-a2", 1, "Obsoleto"),
    /cambió/,
  );
  assert.throws(
    () => f.store.rename("demo-agent-a2", 2, "Otro", "rename-once"),
    /identificador/,
  );
});
test("old Library JSON without studio restores seed readers without changing original bytes", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.library.addFolder("Prueba");
  const d = JSON.parse(f.data.get(f.library.key)!);
  delete d.studio;
  const raw = JSON.stringify(d);
  f.data.set(f.library.key, raw);
  const g = setup("owner", f.data);
  await g.library.hydrate();
  assert.equal(g.store.list().length, 3);
  assert.equal(g.data.get(g.library.key), raw);
});
test("corrupted agent scope, version or general uniqueness fails closed", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.create("Cache");
  for (const mutate of [
    (d: any) => (d.studio.agents[0].general = false),
    (d: any) => (d.studio.agents[0].versions[0].number = -1),
    (d: any) => (d.studio.agents[1].draft.instructions = 42),
  ]) {
    const d = JSON.parse(f.data.get(f.library.key)!);
    mutate(d);
    const data = new Map(f.data);
    data.set(f.library.key, JSON.stringify(d));
    const g = setup("owner", data);
    await g.library.hydrate();
    assert.equal(g.library.snapshot().ready, false);
  }
});
test("another organization cannot restore a copied studio document", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.create("Privado");
  const g = setup("owner", new Map(), "demo-org-other");
  g.data.set(g.library.key, f.data.get(f.library.key)!);
  await g.library.hydrate();
  assert.equal(g.library.snapshot().ready, false);
});
test("observer reentrancy and exceptions cannot duplicate creator operations", async () => {
  const f = setup();
  await f.library.hydrate();
  let second: Promise<string | null> | undefined;
  let once = false;
  f.store.subscribe(() => {
    if (!once && f.library.snapshot().saving) {
      once = true;
      second = f.store.create("Segundo", "second");
    }
  });
  f.store.subscribe(() => {
    throw Error("observer");
  });
  await f.store.create("Primero", "first");
  await second;
  assert.equal(f.store.list().length, 5);
  assert.equal(f.library.snapshot().saving, false);
});
test("model validates bounds and deeply freezes snapshots", () => {
  const d = seedStudio();
  validateStudio(d);
  assert.ok(Object.isFrozen(d.agents[0]!.draft));
  assert.ok(Object.isFrozen(d.agents[0]!.versions[0]!.config));
  assert.throws(() =>
    validateStudio({ ...d, agents: [...d.agents, d.agents[0]!] }),
  );
});
test("archiving also clears reader on an IA destination previously disabled, preserving Chat", async () => {
  const f = setup();
  await f.library.hydrate();
  const e = f.library.get("demo-library-catalog");
  await f.library.save({
    ...e,
    expectedVersion: e.version,
    knowledge: { ...f.library.knowledgeInfo(e), reader: "demo-agent-a2" },
  });
  await f.library.removeKnowledge(e.id, f.library.get(e.id).version);
  await f.store.archive("demo-agent-a2", 1, "general");
  assert.equal(f.library.get(e.id).chat, true);
  assert.equal(f.library.get(e.id).rag, false);
  assert.equal(f.library.get(e.id).knowledge!.reader, null);
});
