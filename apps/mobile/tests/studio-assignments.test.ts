import assert from "node:assert/strict";
import { test } from "node:test";
import { LibraryStore } from "../src/features/library/core";
import { StudioStore } from "../src/features/studio/core";
import {
  DemoConversationRepository,
  stages,
} from "../src/features/inbox/model";
import { CrmModel } from "../src/features/crm/core";
const owner = { id: "demo-owner", role: "owner" } as const;
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
  const repo = new DemoConversationRepository(),
    library = new LibraryStore(owner, "demo-org-cristal", storage);
  return {
    data,
    storage,
    repo,
    library,
    store: new StudioStore(library, repo),
    crm: new CrmModel(owner, repo),
    fail: (v: boolean) => {
      fail = v;
    },
  };
}
test("Studio stage identities names and colors are shared with actual Pipeline model", async () => {
  const f = setup();
  await f.library.hydrate();
  f.crm.addStage("Cotizado");
  f.crm.color("Cotizado", "#8b5cf6");
  const row = f.store.stageRows().find((s) => s.name === "Cotizado")!;
  assert.equal(row.id, f.repo.stageIdentity("Cotizado"));
  assert.equal(
    row.color,
    f.crm.stageList.find((s) => s.name === "Cotizado")!.color,
  );
  f.crm.reorder(f.crm.stageList.length - 1);
  assert.deepEqual(
    f.store.stageRows().map((s) => s.name),
    f.crm.stageList.map((s) => s.name),
  );
});
test("only published non-general agents may be assigned; unassigned uses current general", async () => {
  const f = setup();
  await f.library.hydrate();
  const key = f.repo.stageIdentity("Cliente")!;
  await assert.rejects(f.store.assign(key, "demo-agent-a3", null), /publicado/);
  await assert.rejects(f.store.assign(key, "demo-agent-a1", null), /publicado/);
  await f.store.assign(key, "demo-agent-a2", null);
  assert.equal(f.store.doc().assignments[key], "demo-agent-a2");
  await f.store.assign(key, null, "demo-agent-a2");
  assert.equal(f.store.doc().assignments[key], undefined);
  assert.equal(f.store.route("Cliente", "Hola").decision, "reply");
});
test("same assignment operation replays once, stale replacement rejects without overwriting", async () => {
  const f = setup();
  await f.library.hydrate();
  const key = f.repo.stageIdentity("Cliente")!;
  await f.store.assign(key, "demo-agent-a2", null, "one");
  const revision = f.store.doc().revision;
  await f.store.assign(key, "demo-agent-a2", null, "one");
  assert.equal(f.store.doc().revision, revision);
  await assert.rejects(f.store.assign(key, null, null), /cambió/);
  assert.equal(f.store.doc().assignments[key], "demo-agent-a2");
});
test("failed assignment preserves previous binding; explicit retry succeeds once", async () => {
  const f = setup();
  await f.library.hydrate();
  const key = f.repo.stageIdentity("Nuevo")!;
  f.fail(true);
  await assert.rejects(f.store.assign(key, null, "demo-agent-a2", "retry"));
  assert.equal(f.store.doc().assignments[key], "demo-agent-a2");
  f.fail(false);
  await f.store.assign(key, null, "demo-agent-a2", "retry");
  assert.equal(f.store.doc().assignments[key], undefined);
});
test("deleting then recreating a same-name stage never resurrects its old agent assignment", async () => {
  const f = setup();
  await f.library.hydrate();
  f.crm.addStage("Reutilizada");
  const old = f.repo.stageIdentity("Reutilizada")!;
  await f.store.assign(old, "demo-agent-a2", null);
  f.crm.deleteStage("Reutilizada", "Nuevo");
  f.crm.addStage("Reutilizada");
  const fresh = f.repo.stageIdentity("Reutilizada")!;
  assert.notEqual(fresh, old);
  assert.equal(f.store.doc().assignments[fresh], undefined);
  await assert.rejects(f.store.assign(old, null, "demo-agent-a2"), /existe/);
  await f.store.assign(fresh, "demo-agent-a2", null);
  assert.equal(f.store.doc().assignments[old], undefined);
});
test("new catalog instance cannot reuse persisted custom-stage identity, even under same names", async () => {
  const f = setup();
  await f.library.hydrate();
  f.crm.addStage("Anterior");
  const old = f.repo.stageIdentity("Anterior")!;
  await f.store.assign(old, "demo-agent-a2", null);
  const g = setup(f.data);
  await g.library.hydrate();
  g.crm.addStage("Anterior");
  const fresh = g.repo.stageIdentity("Anterior")!;
  assert.notEqual(fresh, old);
  assert.equal(g.store.doc().assignments[fresh], undefined);
  assert.ok(g.store.doc().assignments[old]);
});
test("seed stage assignment restores while local custom catalog is intentionally not persisted by CRM", async () => {
  const f = setup();
  await f.library.hydrate();
  const key = f.repo.stageIdentity("Cliente")!;
  await f.store.assign(key, "demo-agent-a2", null);
  const g = setup(f.data);
  await g.library.hydrate();
  assert.equal(g.repo.stageIdentity("Cliente"), key);
  assert.equal(g.store.doc().assignments[key], "demo-agent-a2");
});
test("stage deletion during a slow save never routes new conversations through orphan binding", async () => {
  const f = setup();
  await f.library.hydrate();
  f.crm.addStage("Lenta");
  const key = f.repo.stageIdentity("Lenta")!;
  let release!: () => void, entered!: () => void;
  const inside = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r)),
    set = f.storage.set;
  f.storage.set = async (k, v) => {
    entered();
    await gate;
    await set(k, v);
  };
  const save = f.store.assign(key, "demo-agent-a2", null);
  await inside;
  f.crm.deleteStage("Lenta", "Nuevo");
  release();
  await save;
  assert.ok(!f.store.stageRows().some((s) => s.id === key));
  await f.store.pause("demo-agent-a2", 1, true);
  assert.equal(f.store.route("Lenta", "Hola").decision, "reply");
});
test("assigned paused agent hands off, global pause takes precedence and resuming does not unpause it", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.pause("demo-agent-a2", 1, true);
  assert.equal(f.store.route("Nuevo", "Hola").decision, "handoff");
  await f.store.pauseAll(true);
  await f.store.pauseAll(false);
  assert.equal(f.store.route("Nuevo", "Hola").decision, "handoff");
});
test("making assigned agent general or archiving it removes stale explicit overrides atomically", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.makeGeneral("demo-agent-a2", 1);
  assert.ok(
    !Object.values(f.store.doc().assignments).includes("demo-agent-a2"),
  );
  assert.equal(f.store.route("Nuevo", "Hola").decision, "reply");
});
test("catalog subscriptions do not emit for messages and cannot be broken by throwing listeners", () => {
  const f = setup();
  let count = 0;
  f.repo.subscribeCatalog(() => count++);
  f.repo.subscribeCatalog(() => {
    throw Error("observer");
  });
  f.repo.incoming(owner, "demo-conv-1");
  assert.equal(count, 0);
  f.crm.addStage("Local");
  f.crm.color("Local", "#8b5cf6");
  assert.equal(count, 2);
  assert.equal(f.store.stageRows().at(-1)!.color, "#8b5cf6");
});
test("advisor catalog mutations and Studio assignments fail before persistence", async () => {
  const data = new Map<string, string>(),
    storage = {
      get: async () => null,
      set: async () => {
        throw Error("must not write");
      },
      remove: async () => {},
    };
  const library = new LibraryStore(
      { id: "demo-advisor", role: "advisor" },
      "demo-org-cristal",
      storage,
    ),
    repo = new DemoConversationRepository(),
    store = new StudioStore(library, repo);
  await library.hydrate();
  assert.throws(() => repo.setStageColor(library.actor, "Nuevo", "#8b5cf6"));
  assert.throws(
    () => store.assign("demo-stage-1", null, "demo-agent-a2"),
    /perfil/,
  );
});
