import assert from "node:assert/strict";
import { test } from "node:test";
import { LibraryStore, type LibraryFile } from "../src/features/library/core";
import { utf8Size } from "../src/features/knowledge/model";
function setup(
  role: "owner" | "coordinator" | "advisor" = "owner",
  data = new Map<string, string>(),
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
  return {
    store: new LibraryStore(
      { id: "demo-" + role, role },
      "demo-org-cristal",
      storage,
    ),
    data,
    storage,
    fail: (v: boolean) => {
      fail = v;
    },
    writes: () => writes,
  };
}
const pdf: LibraryFile = {
  name: "Muestra demo.pdf",
  kind: "pdf",
  bytes: 20000,
};
test("Knowledge reads the same RAG entries and removes only IA destination when Chat also uses file", async () => {
  const f = setup();
  await f.store.hydrate();
  const e = f.store.knowledgeList("General").find((e) => e.chat)!;
  const before = f.store.get(e.id);
  await f.store.removeKnowledge(e.id, e.version);
  assert.equal(f.store.get(e.id).rag, false);
  assert.equal(f.store.get(e.id).chat, true);
  assert.deepEqual(f.store.get(e.id).file, before.file);
  assert.ok(!f.store.knowledgeList("General").some((x) => x.id === e.id));
  assert.ok(f.store.forChat().some((x) => x.id === e.id));
});
test("upload is fictional metadata only and remains isolated from Chat and Library list", async () => {
  const f = setup();
  await f.store.hydrate();
  const id = await f.store.uploadKnowledge(pdf, "General", null, true);
  const e = f.store.knowledgeGet(id);
  assert.equal(e.knowledge!.status, "processing");
  assert.equal(e.chat, false);
  assert.ok(!f.store.list().some((x) => x.id === id));
  assert.ok(!f.store.forChat().some((x) => x.id === id));
  assert.ok(f.store.knowledgeList("General").some((x) => x.id === id));
});
test("simulated indexing resolves readable and scanned documents with no repeated writes", async () => {
  const f = setup();
  await f.store.hydrate();
  const good = await f.store.uploadKnowledge(pdf, "General", null, true),
    bad = await f.store.uploadKnowledge(
      { ...pdf, name: "Escaneo.pdf" },
      "General",
      null,
      false,
    );
  await f.store.finishKnowledge();
  assert.equal(f.store.knowledgeGet(good).knowledge!.status, "indexed");
  assert.equal(f.store.knowledgeGet(bad).knowledge!.status, "failed");
  const writes = f.writes();
  await f.store.finishKnowledge();
  assert.equal(f.writes(), writes);
});
test("move updates Library editor metadata and survives restoration without duplicate copies", async () => {
  const f = setup();
  await f.store.hydrate();
  const e = f.store.knowledgeList("General")[0]!;
  await f.store.moveKnowledge(e.id, e.version, "Ventas");
  assert.equal(f.store.get(e.id).knowledge!.group, "Ventas");
  assert.ok(!f.store.knowledgeList("General").some((x) => x.id === e.id));
  const g = setup("owner", f.data);
  await g.store.hydrate();
  assert.equal(g.store.knowledgeList("Ventas")[0]!.id, e.id);
});
test("exclusive reader uses stable demo agent and is filtered logically without copying document", async () => {
  const f = setup();
  await f.store.hydrate();
  const id = await f.store.uploadKnowledge(
    pdf,
    "Ventas",
    "demo-agent-a2",
    true,
  );
  assert.equal(f.store.knowledgeList("Exclusivos")[0]!.id, id);
  assert.equal(f.store.knowledgeInfo(f.store.get(id)).reader, "demo-agent-a2");
  await assert.rejects(
    f.store.uploadKnowledge(pdf, "General", "real-agent", true),
  );
});
test("advisor and coordinator cannot use Studio operations or direct read of Studio-only metadata", async () => {
  for (const role of ["advisor", "coordinator"] as const) {
    const f = setup(role);
    await f.store.hydrate();
    assert.throws(() => f.store.knowledgeList("General"), /perfil/);
    await assert.rejects(
      f.store.uploadKnowledge(pdf, "General", null, true),
      /perfil/,
    );
    await assert.rejects(f.store.addKnowledgeGroup("Nuevo"), /perfil/);
    await assert.rejects(f.store.finishKnowledge(), /perfil/);
  }
});
test("groups persist separately from Library folders and reject reserved/duplicate labels", async () => {
  const f = setup();
  await f.store.hydrate();
  await f.store.addKnowledgeGroup("Dirección");
  assert.ok(!f.store.snapshot().folders.includes("Dirección"));
  await assert.rejects(f.store.addKnowledgeGroup("direccion"));
  await assert.rejects(f.store.addKnowledgeGroup("Exclusivos"));
  const g = setup("owner", f.data);
  await g.store.hydrate();
  assert.ok(g.store.snapshot().knowledgeGroups.includes("Dirección"));
});
test("invalid type, bytes, group, corrupt metadata cannot persist", async () => {
  const f = setup();
  await f.store.hydrate();
  for (const file of [
    { ...pdf, kind: "image" as const },
    { ...pdf, bytes: 21 * 1024 * 1024 },
    { ...pdf, bytes: 0 },
    { ...pdf, name: "mal.exe" },
  ])
    await assert.rejects(f.store.uploadKnowledge(file, "General", null, true));
  await assert.rejects(f.store.uploadKnowledge(pdf, "Unknown", null, true));
  assert.equal(f.writes(), 0);
});
test("failed upload or index preserves original data and retry does not duplicate successful rows", async () => {
  const f = setup();
  await f.store.hydrate();
  f.fail(true);
  await assert.rejects(f.store.uploadKnowledge(pdf, "General", null, true));
  assert.equal(f.store.snapshot().entries.length, 4);
  f.fail(false);
  const id = await f.store.uploadKnowledge(pdf, "General", null, true);
  f.fail(true);
  await assert.rejects(f.store.finishKnowledge());
  assert.equal(f.store.knowledgeGet(id).knowledge!.status, "processing");
  f.fail(false);
  await f.store.finishKnowledge();
  assert.equal(f.store.knowledgeGet(id).knowledge!.status, "indexed");
  assert.equal(f.store.snapshot().entries.length, 5);
});
test("stale detail cannot delete or move after indexing changed version", async () => {
  const f = setup();
  await f.store.hydrate();
  const id = await f.store.uploadKnowledge(pdf, "General", null, true),
    e = f.store.knowledgeGet(id);
  await f.store.finishKnowledge();
  await assert.rejects(f.store.removeKnowledge(id, e.version), /cambió/);
  await assert.rejects(
    f.store.moveKnowledge(id, e.version, "Ventas"),
    /cambió/,
  );
});
test("deleting IA-only document does not resurrect after restoring; other entries keep identity", async () => {
  const f = setup();
  await f.store.hydrate();
  const id = await f.store.uploadKnowledge(pdf, "General", null, true),
    other = f.store.snapshot().entries[0]!;
  await f.store.removeKnowledge(id, 1);
  assert.equal(f.store.snapshot().entries[0], other);
  const g = setup("owner", f.data);
  await g.store.hydrate();
  assert.throws(() => g.store.knowledgeGet(id));
});
test("old Library JSON without Knowledge fields restores with defaults; editing preserves doc group", async () => {
  const f = setup();
  await f.store.hydrate();
  const e = f.store.snapshot().entries[0]!;
  await f.store.moveKnowledge(e.id, e.version, "Ventas");
  const edited = f.store.get(e.id);
  const { knowledge: _, ...draft } = edited;
  await f.store.save({
    ...draft,
    expectedVersion: edited.version,
    title: "Cambio Biblioteca",
  });
  assert.equal(f.store.get(e.id).knowledge!.group, "Ventas");
  const d = JSON.parse(f.data.get(f.store.key)!);
  delete d.knowledgeGroups;
  for (const e of d.entries) delete e.knowledge;
  f.data.set(f.store.key, JSON.stringify(d));
  const g = setup("owner", f.data);
  await g.store.hydrate();
  assert.equal(g.store.snapshot().ready, true);
  assert.equal(g.store.knowledgeList("General").length, 3);
});
test("tampered Knowledge scope or cache is rejected without overwriting local evidence", async () => {
  const f = setup();
  await f.store.hydrate();
  await f.store.uploadKnowledge(pdf, "General", null, true);
  const d = JSON.parse(f.data.get(f.store.key)!);
  d.entries.at(-1).knowledge.reader = "production-user";
  const raw = JSON.stringify(d);
  f.data.set(f.store.key, raw);
  const g = setup("owner", f.data);
  await g.store.hydrate();
  assert.equal(g.store.snapshot().ready, false);
  assert.equal(g.data.get(f.store.key), raw);
});
test("UTF8 size works without browser TextEncoder in native Hermes", () => {
  for (const s of ["Texto", "México", "🎉", "\ud800"])
    assert.equal(utf8Size(s), new TextEncoder().encode(s).length);
});
test("coordinator direct Library route cannot expose a Studio-only upload even with cache bytes in own scope", async () => {
  const f = setup();
  await f.store.hydrate();
  const id = await f.store.uploadKnowledge(pdf, "General", null, true),
    g = setup("coordinator");
  const d = JSON.parse(f.data.get(f.store.key)!);
  d.userId = "demo-coordinator";
  g.data.set(g.store.key, JSON.stringify(d));
  await g.store.hydrate();
  assert.equal(g.store.snapshot().ready, true);
  assert.throws(() => g.store.get(id), /acceso/);
  assert.ok(!g.store.list().some((e) => e.id === id));
});
