import assert from "node:assert/strict";
import { test } from "node:test";
import { LibraryStore } from "../src/features/library/core";
import { StudioStore } from "../src/features/studio/core";
import { DemoConversationRepository } from "../src/features/inbox/model";
const id = "demo-agent-a1";
function setup(data = new Map<string, string>()) {
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
  const library = new LibraryStore(
      { id: "demo-owner", role: "owner" },
      "demo-org-cristal",
      storage,
    ),
    conversations = new DemoConversationRepository();
  return {
    data,
    storage,
    library,
    store: new StudioStore(library, conversations, () => 2_000_000_000_000),
    conversations,
    fail: (v: boolean) => {
      fail = v;
    },
    writes: () => writes,
  };
}
test("publish snapshots exact saved draft and later edits cannot mutate any old version", async () => {
  const f = setup();
  await f.library.hydrate();
  f.store.edit(id, { greeting: "Segundo saludo" });
  await f.store.flush(id);
  const a = f.store.get(id),
    draft = JSON.stringify(a.draft),
    v1 = a.versions[0];
  await f.store.publish(id, a.revision, "pub");
  const v2 = f.store.get(id).versions[1]!;
  assert.equal(JSON.stringify(v2.config), draft);
  assert.equal(v2.number, 2);
  assert.ok(Object.isFrozen(v2.config));
  f.store.edit(id, { greeting: "Tercero" });
  await f.store.flush(id);
  assert.equal(v2.config.greeting, "Segundo saludo");
  assert.equal(f.store.get(id).versions[0], v1);
});
test("publication receipt replay after restoration never appends a duplicate version", async () => {
  const f = setup();
  await f.library.hydrate();
  f.store.edit(id, { tone: "Formal" });
  await f.store.flush(id);
  const a = f.store.get(id);
  await Promise.all([
    f.store.publish(id, a.revision, "once"),
    f.store.publish(id, a.revision, "once"),
  ]);
  const g = setup(f.data);
  await g.library.hydrate();
  await g.store.publish(id, a.revision, "once");
  assert.equal(g.store.get(id).versions.length, 2);
});
test("failed publication preserves previous live version and allows one retry", async () => {
  const f = setup();
  await f.library.hydrate();
  f.store.edit(id, { tone: "Distinto" });
  await f.store.flush(id);
  const a = f.store.get(id);
  f.fail(true);
  await assert.rejects(f.store.publish(id, a.revision, "retry"));
  assert.equal(f.store.get(id), a);
  f.fail(false);
  await f.store.publish(id, a.revision, "retry");
  assert.equal(f.store.get(id).versions.length, 2);
});
test("dirty, empty, unchanged and stale drafts cannot be published", async () => {
  const f = setup();
  await f.library.hydrate();
  await assert.rejects(f.store.publish(id, 1), /cambios/);
  f.store.edit(id, { tone: "Pendiente" });
  await assert.rejects(f.store.publish(id, 1), /borrador/);
  await f.store.flush(id);
  await assert.rejects(f.store.publish(id, 1), /cambió/);
  const blank = await f.store.create();
  await assert.rejects(f.store.publish(blank!, 1), /instrucciones/);
});
test("version load changes only draft, keeps current published version and complete history", async () => {
  const f = setup();
  await f.library.hydrate();
  f.store.edit(id, { greeting: "v2" });
  await f.store.flush(id);
  await f.store.publish(id, f.store.get(id).revision);
  const a = f.store.get(id),
    history = JSON.stringify(a.versions);
  await f.store.loadVersion(id, a.revision, 1);
  assert.equal(f.store.get(id).draft.greeting, a.versions[0]!.config.greeting);
  assert.equal(f.store.get(id).versions.at(-1)!.config.greeting, "v2");
  assert.equal(JSON.stringify(f.store.get(id).versions), history);
});
test("failed load and missing/stale version keep draft and buffer for recovery", async () => {
  const f = setup();
  await f.library.hydrate();
  f.store.edit(id, { greeting: "Búfer sin guardar" });
  const a = f.store.get(id);
  f.fail(true);
  await assert.rejects(f.store.loadVersion(id, a.revision, 1, "load"));
  assert.equal(f.store.config(id).greeting, "Búfer sin guardar");
  f.fail(false);
  await assert.rejects(f.store.loadVersion(id, a.revision, 99), /disponible/);
  await f.store.rename(id, a.revision, "Nombre");
  await assert.rejects(f.store.loadVersion(id, a.revision, 1), /cambió/);
});
test("text typed during a slow version load survives and rebases only newer fields", async () => {
  const f = setup();
  await f.library.hydrate();
  f.store.edit(id, { tone: "Tono v2", greeting: "Saludo v2" });
  await f.store.flush(id);
  const a = f.store.get(id);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    inside = new Promise<void>((r) => (entered = r)),
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
  const loading = f.store.loadVersion(id, a.revision, 1);
  await inside;
  f.store.edit(id, { greeting: "Texto posterior" });
  release();
  await loading;
  assert.equal(f.store.config(id).greeting, "Texto posterior");
  assert.equal(f.store.config(id).tone, a.versions[0]!.config.tone);
  await f.store.flush(id);
  assert.equal(f.store.get(id).draft.greeting, "Texto posterior");
});
test("replaying a successful version-load receipt does not clear newly typed draft text", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.loadVersion(id, 1, 1, "old-load");
  f.store.edit(id, { greeting: "No borrar" });
  await f.store.loadVersion(id, 1, 1, "old-load");
  assert.equal(f.store.config(id).greeting, "No borrar");
  assert.equal(f.store.dirty(id), true);
});
test("global pause routes all stages to a person, without mutating existing Chat or conversations", async () => {
  const f = setup();
  await f.library.hydrate();
  const source = f.conversations.list(f.library.actor),
    before = source[0];
  assert.equal(f.store.route("Cliente", "Hola").decision, "reply");
  await f.store.pauseAll(true);
  for (const stage of ["Nuevo", "Cliente", "Desconocida"])
    assert.equal(f.store.route(stage, "Hola").decision, "handoff");
  assert.equal(f.conversations.list(f.library.actor)[0], before);
  assert.equal(f.store.preview(id, "Hola").decision, "reply");
  await f.store.pauseAll(false);
  assert.equal(f.store.route("Cliente", "Hola").decision, "reply");
});
test("pause and per-agent state restore independently; failed pause does not falsely show a new state", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.pause("demo-agent-a2", 1, true);
  await f.store.pauseAll(true);
  const g = setup(f.data);
  await g.library.hydrate();
  assert.equal(g.store.doc().globalPaused, true);
  await g.store.pauseAll(false);
  assert.equal(g.store.route("Nuevo", "Hola").decision, "handoff");
  g.fail(true);
  await assert.rejects(g.store.pauseAll(true));
  assert.equal(g.store.doc().globalPaused, false);
});
test("making an agent general requires publication, preserves one general and clears its stage overrides", async () => {
  const f = setup();
  await f.library.hydrate();
  await assert.rejects(f.store.makeGeneral("demo-agent-a3", 1), /Publica/);
  await f.store.makeGeneral("demo-agent-a2", 1);
  assert.equal(f.store.list().filter((a) => a.general).length, 1);
  assert.equal(f.store.get("demo-agent-a2").general, true);
  assert.ok(
    !Object.values(f.store.doc().assignments).includes("demo-agent-a2"),
  );
  assert.equal(f.store.get("demo-agent-a2").draft.sharedKnowledge, true);
  await assert.rejects(
    f.store.archive("demo-agent-a2", 2, "general"),
    /general/,
  );
});
test("restoring an old sharedKnowledge=false version cannot disable sharing for current general", async () => {
  const f = setup();
  await f.library.hydrate();
  const a2 = "demo-agent-a2";
  f.store.edit(a2, { sharedKnowledge: false });
  await f.store.flush(a2);
  await f.store.publish(a2, f.store.get(a2).revision);
  await f.store.makeGeneral(a2, f.store.get(a2).revision);
  await f.store.loadVersion(a2, f.store.get(a2).revision, 2);
  assert.equal(f.store.get(a2).draft.sharedKnowledge, true);
});
