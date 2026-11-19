import assert from "node:assert/strict";
import { test } from "node:test";
import { LibraryStore } from "../src/features/library/core";
import { StudioStore } from "../src/features/studio/core";
import { DemoConversationRepository } from "../src/features/inbox/model";
function setup(data = new Map<string, string>()) {
  let fail = false;
  const storage = {
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => {
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
    library,
    store: new StudioStore(library, conversations, () => 2_000_000_000_000),
    conversations,
    fail: (v: boolean) => {
      fail = v;
    },
  };
}
const id = "demo-agent-a1";
test("3/5/8 client simulations create complete local results without changing conversations", async () => {
  const f = setup();
  await f.library.hydrate();
  const c = f.conversations.get(f.library.actor, "demo-conv-1");
  for (const n of [3, 5, 8] as const) {
    const key = await f.store.run(id, "draft", n),
      r = f.store.runGet(key!);
    assert.equal(r.results.length, n);
    assert.ok(r.results.every((e) => e.attempts?.length === 1));
  }
  assert.equal(f.conversations.get(f.library.actor, c.id), c);
});
test("run saves an immutable configuration snapshot independent of future draft/published changes", async () => {
  const f = setup();
  await f.library.hydrate();
  const key = await f.store.run(id, "published", 3),
    run = f.store.runGet(key!);
  assert.equal(run.version, 1);
  const before = JSON.stringify(run);
  f.store.edit(id, { tone: "Tono posterior" });
  await f.store.flush(id);
  assert.equal(JSON.stringify(f.store.runGet(key!)), before);
  assert.ok(Object.isFrozen(run.config));
  assert.ok(Object.isFrozen(run.results[0]!.attempts![0]!.config));
});
test("draft and published simulations use their selected versions instead of silently sharing latest draft", async () => {
  const f = setup();
  await f.library.hydrate();
  f.store.edit(id, { handoff: "" });
  await f.store.flush(id);
  const a = await f.store.run(id, "draft", 3),
    b = await f.store.run(id, "published", 3);
  assert.equal(f.store.runGet(a!).results[2]!.grade, "failed");
  assert.equal(f.store.runGet(b!).results[2]!.grade, "ok");
});
test("same run receipt is safe after restoration and does not duplicate result sets", async () => {
  const f = setup();
  await f.library.hydrate();
  const key = await f.store.run(id, "draft", 3, "once"),
    g = setup(f.data);
  await g.library.hydrate();
  assert.equal(await g.store.run(id, "draft", 3, "once"), key);
  assert.equal(g.store.doc().runs.length, 1);
});
test("bad counts, unknown agents, unpublished version, empty or dirty drafts cannot start a run", async () => {
  const f = setup();
  await f.library.hydrate();
  await assert.rejects(f.store.run(id, "draft", 4 as never));
  await assert.rejects(f.store.run("demo-agent-no", "draft", 3));
  await assert.rejects(f.store.run("demo-agent-a3", "published", 3));
  const blank = await f.store.create();
  await assert.rejects(f.store.run(blank!, "draft", 3), /instrucciones/);
  f.store.edit(id, { tone: "Sin guardar" });
  await assert.rejects(f.store.run(id, "draft", 3), /Guarda/);
});
test("fix changes only draft, retains original failed transcript, and repeat uses a separately traced draft attempt", async () => {
  const f = setup();
  await f.library.hydrate();
  f.store.edit(id, { handoff: "" });
  await f.store.flush(id);
  const key = (await f.store.run(id, "draft", 3))!,
    run = f.store.runGet(key),
    e = run.results[2]!,
    versions = JSON.stringify(f.store.get(id).versions);
  await f.store.proposeFix(key, e.id, f.store.get(id).revision);
  assert.equal(JSON.stringify(f.store.get(id).versions), versions);
  assert.equal(f.store.runGet(key).results[2]!.answer, e.answer);
  assert.ok(f.store.get(id).draft.instructions.includes("\n"));
  await f.store.repeat(key, e.id);
  const result = f.store.runGet(key).results[2]!;
  assert.equal(result.grade, "ok");
  assert.equal(result.attempts![0]!.grade, "failed");
  assert.equal(result.attempts![0]!.config.handoff, "");
  assert.equal(result.attempts!.at(-1)!.source, "draft");
});
test("appointment review proposes the appropriate availability rule, then repetition improves", async () => {
  const f = setup();
  await f.library.hydrate();
  const key = (await f.store.run(id, "draft", 3))!,
    e = f.store.runGet(key).results[1]!;
  assert.equal(e.grade, "review");
  await f.store.proposeFix(key, e.id, f.store.get(id).revision);
  assert.match(f.store.get(id).draft.handoff, /disponibilidad confirmada/);
  await f.store.repeat(key, e.id);
  assert.equal(f.store.runGet(key).results[1]!.grade, "ok");
});
test("repeated trial retains original attempt plus latest four attempts and never mutates original run source", async () => {
  const f = setup();
  await f.library.hydrate();
  const key = (await f.store.run(id, "published", 3))!,
    e = f.store.runGet(key).results[0]!,
    first = e.attempts![0]!;
  for (let i = 0; i < 8; i++) await f.store.repeat(key, e.id);
  const run = f.store.runGet(key),
    result = run.results[0]!;
  assert.equal(result.repeat, 8);
  assert.equal(result.attempts!.length, 5);
  assert.deepEqual(result.attempts![0], first);
  assert.equal(run.source, "published");
  assert.equal(run.version, 1);
});
test("failed run or fix retains original document for retry without false success", async () => {
  const f = setup();
  await f.library.hydrate();
  const before = f.store.doc();
  f.fail(true);
  await assert.rejects(f.store.run(id, "draft", 3, "retry"));
  assert.equal(f.store.doc(), before);
  f.fail(false);
  const key = (await f.store.run(id, "draft", 3, "retry"))!,
    e = f.store.runGet(key).results[1]!,
    draft = f.store.get(id).draft;
  f.fail(true);
  await assert.rejects(f.store.proposeFix(key, e.id, f.store.get(id).revision));
  assert.equal(f.store.get(id).draft, draft);
  assert.equal(f.store.runGet(key).results[1]!.proposed, false);
});
test("stale fix, archived agent and unsaved repetition fail without changing historical results", async () => {
  const f = setup();
  await f.library.hydrate();
  const key = (await f.store.run(id, "draft", 3))!,
    e = f.store.runGet(key).results[1]!;
  await assert.rejects(f.store.proposeFix(key, e.id, 0), /cambió/);
  f.store.edit(id, { tone: "Pendiente" });
  await assert.rejects(f.store.repeat(key, e.id), /Guarda/);
  assert.equal(f.store.runGet(key).results[1]!.repeat, 0);
});
test("history is bounded at 20 runs and scoped to current local Library document", async () => {
  const f = setup();
  await f.library.hydrate();
  const first = (await f.store.run(id, "draft", 3))!;
  for (let i = 0; i < 20; i++) await f.store.run(id, "draft", 3);
  assert.equal(f.store.doc().runs.length, 20);
  assert.throws(() => f.store.runGet(first), /disponible/);
  const g = setup(new Map());
  await g.library.hydrate();
  assert.equal(g.store.doc().runs.length, 0);
});
test("creator starts a fresh draft after its previous proposal is locally published", async () => {
  const f = setup();
  await f.library.hydrate();
  const first = (await f.store.creator("Tengo una joyería"))!;
  await f.store.publish(first, f.store.get(first).revision);
  const second = await f.store.creator("Otro negocio de prueba");
  assert.notEqual(first, second);
  assert.equal(f.store.get(first).versions.length, 1);
  assert.equal(f.store.get(second!).versions.length, 0);
});
