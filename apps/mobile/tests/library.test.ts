import assert from "node:assert/strict";
import { test } from "node:test";
import { LibraryStore, type LibraryDraft } from "../src/features/library/core";
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
    store: new LibraryStore({ id: `demo-${role}`, role }, org, storage),
    memory,
    storage,
  };
};
const draft = (p: Partial<LibraryDraft> = {}): LibraryDraft => ({
  title: "Política de demostración",
  content: "Texto ficticio",
  folder: "Políticas",
  tags: [],
  chat: true,
  rag: false,
  file: null,
  ...p,
});
test("library restores local edits, tags and folders without replacing other entries", async () => {
  const { store, memory } = setup();
  await store.hydrate();
  await store.addFolder("Cursos");
  const id = await store.save(draft({ folder: "Cursos", tags: ["demo"] }));
  const restored = setup("owner", "demo-org-cristal", memory).store;
  await restored.hydrate();
  assert.equal(restored.get(id).folder, "Cursos");
  assert.ok(restored.snapshot().folders.includes("Cursos"));
  assert.equal(restored.list().length, 5);
});
test("library rejects invalid fields, unavailable folders, no destination and oversized files", async () => {
  const { store } = setup();
  await store.hydrate();
  for (const p of [
    { title: " " },
    { content: "" },
    { chat: false, rag: false },
    { folder: "Otra" },
    { tags: ["demo", "demo"] },
    {
      file: {
        name: "muestra.pdf",
        kind: "pdf" as const,
        bytes: 100 * 1024 * 1024 + 1,
      },
    },
  ])
    await assert.rejects(store.save(draft(p)));
  assert.equal(store.list().length, 4);
});
test("advisor cannot manage library, read IA-only entries or forge direct entry access", async () => {
  const { store } = setup("advisor");
  await store.hydrate();
  assert.equal(store.list().length, 3);
  assert.ok(store.list().every((e) => e.chat));
  assert.throws(() => store.get("demo-library-faq"));
  assert.throws(() => store.open(null));
  await assert.rejects(store.save(draft()));
  await assert.rejects(store.addFolder("Otro"));
  await assert.rejects(store.remove("demo-library-catalog", 1));
});
test("coordinator may manage fictitious knowledge and deletion checks entry version", async () => {
  const { store } = setup("coordinator");
  await store.hydrate();
  const id = await store.save(draft());
  await assert.rejects(store.remove(id, 2));
  await store.remove(id, 1);
  assert.throws(() => store.get(id));
});
test("library isolates organizations and users in storage and rejects forged persisted scope", async () => {
  const { store, memory } = setup();
  await store.hydrate();
  const id = await store.save(draft());
  for (const s of [
    setup("owner", "demo-org-other", memory).store,
    setup("coordinator", "demo-org-cristal", memory).store,
  ]) {
    await s.hydrate();
    assert.throws(() => s.get(id));
  }
  const other = setup("owner", "demo-org-other", memory).store;
  memory.set(other.key, memory.get(store.key)!);
  await other.hydrate();
  assert.equal(other.snapshot().ready, false);
  assert.equal(other.snapshot().status, "error");
  assert.equal(memory.get(store.key), memory.get(other.key));
});
test("corrupt cache remains untouched and writes are blocked until successful restore", async () => {
  const { store, memory } = setup();
  memory.set(store.key, "{broken");
  await store.hydrate();
  assert.equal(store.snapshot().ready, false);
  await assert.rejects(store.save(draft()));
  assert.equal(memory.get(store.key), "{broken");
  memory.delete(store.key);
  await store.hydrate();
  assert.equal(store.snapshot().ready, true);
});
test("failed local save keeps prior catalog and draft remains retryable", async () => {
  const { store, storage } = setup();
  await store.hydrate();
  const write = storage.set;
  storage.set = async () => {
    throw Error("No space");
  };
  await assert.rejects(store.save(draft()));
  assert.equal(store.list().length, 4);
  assert.equal(store.snapshot().saving, false);
  storage.set = write;
  await store.save(draft());
  assert.equal(store.list().length, 5);
});
test("stale editor cannot overwrite an updated entry and concurrent saves do not duplicate", async () => {
  const { store } = setup();
  await store.hydrate();
  const id = await store.save(draft());
  await store.save(draft({ id, expectedVersion: 1, title: "Actualizada" }));
  await assert.rejects(store.save(draft({ id, expectedVersion: 1 })));
  const work = await Promise.allSettled([
    store.save(draft()),
    store.save(draft()),
  ]);
  assert.equal(work.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(store.list().length, 6);
});
test("search matches title or content ignoring accents; folder and tag filters survive editor navigation", async () => {
  const { store } = setup();
  await store.hydrate();
  const id = await store.save(
    draft({ content: "Promoción ágil", tags: ["demo"] }),
  );
  store.configure({ query: "AGIL", folder: "Políticas", tag: "demo" });
  store.open(id);
  store.back();
  assert.equal(store.list().length, 1);
  assert.equal(store.snapshot().query, "AGIL");
  assert.equal(store.forChat()[0]?.id, id);
});
test("hydration coalesces through reentrant subscribers and observer failure does not strand writes", async () => {
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
  await store.save(draft());
  assert.equal(store.snapshot().saving, false);
});

test("library snapshots actor identity and cannot reuse IDs after restoring at the same clock tick", async () => {
  const memory = new Map<string, string>(),
    { storage } = setup("owner", "demo-org-cristal", memory);
  const actor = { id: "demo-owner", role: "owner" as "owner" | "advisor" };
  const originalNow = Date.now;
  Date.now = () => 1795080000000;
  try {
    const first = new LibraryStore(actor, "demo-org-cristal", storage);
    actor.id = "demo-foreign";
    actor.role = "advisor";
    await first.hydrate();
    assert.equal(first.actor.id, "demo-owner");
    assert.equal(first.actor.role, "owner");
    const id = await first.save(draft());
    const second = setup("owner", "demo-org-cristal", memory).store;
    await second.hydrate();
    const other = await second.save(draft());
    assert.notEqual(id, other);
    assert.equal(second.list().length, 6);
  } finally {
    Date.now = originalNow;
  }
});

test("confirmed deletion atomically leaves the editor before observers can read a removed entry", async () => {
  const { store } = setup();
  await store.hydrate();
  const id = await store.save(draft());
  store.open(id);
  const errors: unknown[] = [];
  store.subscribe(() => {
    const s = store.snapshot();
    if (s.screen === "CRM-41" && s.entryId)
      try {
        store.get(s.entryId);
      } catch (e) {
        errors.push(e);
      }
  });
  await store.remove(id, 1);
  assert.deepEqual(errors, []);
  assert.equal(store.snapshot().screen, "CRM-40");
});
