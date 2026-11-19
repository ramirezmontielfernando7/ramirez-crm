import assert from "node:assert/strict";
import { test } from "node:test";
import { LibraryStore } from "../src/features/library/core";
import { StudioStore } from "../src/features/studio/core";
import { DemoConversationRepository } from "../src/features/inbox/model";
function setup(
  data = new Map<string, string>(),
  role: "owner" | "coordinator" | "advisor" = "owner",
  now = Date.parse("2026-11-19T12:00:00-05:00"),
) {
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
      { id: `demo-${role}`, role },
      "demo-org-cristal",
      storage,
    ),
    conversations = new DemoConversationRepository();
  return {
    data,
    library,
    store: new StudioStore(library, conversations, () => now),
    conversations,
    fail: (v: boolean) => {
      fail = v;
    },
  };
}
test("assistant reads shared Results and Agent figures without sending messages or using IA", async () => {
  const f = setup();
  await f.library.hydrate();
  const before = f.conversations.get(f.library.actor, "demo-conv-1");
  await f.store.assistantAsk("¿Cuánto vendí este mes?");
  assert.match(f.store.activeAssistant().turns[0]!.answer, /26,200/);
  await f.store.assistantAsk("Audita mis agentes de IA");
  assert.match(f.store.activeAssistant().turns[1]!.answer, /3 agentes/);
  assert.equal(f.conversations.get(f.library.actor, "demo-conv-1"), before);
});
test("tagging request proposes only; explicit Apply updates canonical contacts atomically and idempotently", async () => {
  const f = setup();
  await f.library.hydrate();
  const before = f.conversations.get(f.library.actor, "demo-conv-1");
  await f.store.assistantAsk("Etiqueta a quienes pidieron cotización");
  const t = f.store.activeAssistant().turns[0]!;
  assert.ok(t.tagTargets?.length);
  assert.equal(f.conversations.get(f.library.actor, before.id), before);
  f.store.assistantApplyTags(t.id);
  assert.equal(f.store.assistantTagsApplied(t), true);
  const count = f.conversations.get(f.library.actor, before.id).tags.length;
  f.store.assistantApplyTags(t.id);
  assert.equal(
    f.conversations.get(f.library.actor, before.id).tags.length,
    count,
  );
});
test("discarded proposal is retained as conversation but cannot mutate tags", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.assistantAsk("Etiqueta cotización");
  const t = f.store.activeAssistant().turns[0]!,
    before = f.conversations.get(f.library.actor, "demo-conv-1");
  await f.store.assistantDismiss(t.id);
  assert.equal(f.store.activeAssistant().turns[0]!.dismissed, true);
  assert.throws(() => f.store.assistantApplyTags(t.id), /descartada/);
  assert.equal(f.conversations.get(f.library.actor, before.id), before);
});
test("proposal with a contact archived after drafting fails without partially tagging other contacts", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.assistantAsk("Etiqueta cotización");
  const t = f.store.activeAssistant().turns[0]!,
    ids = t.tagTargets!;
  f.conversations.archive(f.library.actor, [ids.at(-1)!]);
  const first = f.conversations.get(f.library.actor, ids[0]!);
  assert.throws(() => f.store.assistantApplyTags(t.id), /alcance/);
  assert.equal(f.conversations.get(f.library.actor, ids[0]!), first);
});
test("chat general is fixed; new threads select/archive independently and restore locally", async () => {
  const f = setup();
  await f.library.hydrate();
  await assert.rejects(
    f.store.assistantArchive("demo-assistant-general"),
    /fijo/,
  );
  const id = (await f.store.assistantNew("Auditoría QA"))!;
  await f.store.assistantAsk("Audita mis agentes");
  const g = setup(f.data);
  await g.library.hydrate();
  assert.equal(g.store.activeAssistant().id, id);
  assert.equal(g.store.activeAssistant().turns.length, 1);
  await g.store.assistantArchive(id);
  assert.equal(g.store.activeAssistant().id, "demo-assistant-general");
  assert.ok(!g.store.assistantThreads().some((t) => t.id === id));
});
test("mode is only a saved local preference and never changes trial data or performs network work", async () => {
  const f = setup();
  await f.library.hydrate();
  const agents = f.store.doc().agents;
  await f.store.assistantMode("deep");
  assert.equal(f.store.assistantData().mode, "deep");
  assert.equal(f.store.doc().agents[0], agents[0]);
  const g = setup(f.data);
  await g.library.hydrate();
  assert.equal(g.store.assistantData().mode, "deep");
  await assert.rejects(g.store.assistantMode("invalid" as never));
});
test("trial link preserves exact evaluation context and follow-up does not mutate published config", async () => {
  const f = setup();
  await f.library.hydrate();
  const run = (await f.store.run("demo-agent-a1", "draft", 3))!,
    e = f.store.runGet(run).results[1]!,
    versions = JSON.stringify(f.store.get("demo-agent-a1").versions);
  await f.store.assistantContext(run, e.id);
  assert.deepEqual(f.store.activeAssistant().turns[0]!.context, {
    runId: run,
    evaluationId: e.id,
  });
  await f.store.assistantAsk("¿Qué pasó?");
  assert.match(
    f.store.activeAssistant().turns.at(-1)!.answer,
    /Sobre «Quiere una cita»/,
  );
  assert.equal(JSON.stringify(f.store.get("demo-agent-a1").versions), versions);
});
test("failed request retains original thread and same-key retry does not duplicate turns", async () => {
  const f = setup();
  await f.library.hydrate();
  f.fail(true);
  await assert.rejects(f.store.assistantAsk("Audita mis agentes", "retry"));
  assert.equal(f.store.activeAssistant().turns.length, 0);
  f.fail(false);
  await f.store.assistantAsk("Audita mis agentes", "retry");
  await f.store.assistantAsk("Audita mis agentes", "retry");
  assert.equal(f.store.activeAssistant().turns.length, 1);
});
test("assistant history respects 90-day read window while keeping fixed general chat", async () => {
  const f = setup();
  await f.library.hydrate();
  const id = (await f.store.assistantNew("Vencerá"))!;
  const later = setup(f.data, "owner", Date.parse("2027-04-01T12:00:00-05:00"));
  await later.library.hydrate();
  assert.ok(!later.store.assistantThreads().some((t) => t.id === id));
  assert.equal(later.store.activeAssistant().id, "demo-assistant-general");
  assert.ok(
    later.store
      .assistantThreads()
      .some((t) => t.id === "demo-assistant-general"),
  );
});
test("roles and org/user-scoped documents cannot leak assistant conversations", async () => {
  for (const role of ["advisor", "coordinator"] as const) {
    const f = setup(new Map(), role);
    await f.library.hydrate();
    assert.throws(() => f.store.assistantData(), /perfil/);
    assert.throws(() => f.store.assistantAsk("Audita"), /perfil/);
  }
  const f = setup();
  await f.library.hydrate();
  await f.store.assistantAsk("Consulta de un perfil");
  const g = setup();
  await g.library.hydrate();
  assert.equal(g.store.activeAssistant().turns.length, 0);
});
test("assistant defaults hydrate old Studio documents without erasing agent drafts or writing", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.create("Previo");
  const original = f.data.get(f.library.key)!,
    g = setup(f.data);
  await g.library.hydrate();
  assert.equal(g.store.activeAssistant().turns.length, 0);
  assert.equal(g.store.list().length, 4);
  assert.equal(g.data.get(g.library.key), original);
});
test("tag proposals remain coherent with session-only conversation repository after restart", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.assistantAsk("Etiqueta cotización");
  const t = f.store.activeAssistant().turns[0]!;
  f.store.assistantApplyTags(t.id);
  assert.equal(f.store.assistantTagsApplied(t), true);
  const g = setup(f.data);
  await g.library.hydrate();
  assert.equal(
    g.store.assistantTagsApplied(g.store.activeAssistant().turns[0]!),
    false,
  );
  assert.ok(!g.store.activeAssistant().turns[0]!.dismissed);
});
