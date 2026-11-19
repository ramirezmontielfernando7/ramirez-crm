import assert from "node:assert/strict";
import { test } from "node:test";
import { LibraryStore } from "../src/features/library/core";
import { StudioStore } from "../src/features/studio/core";
import { DemoConversationRepository } from "../src/features/inbox/model";
import {
  usageFixture,
  usageSummary,
  validateUsage,
} from "../src/features/studio/usage-model";
function setup(
  data = new Map<string, string>(),
  role: "owner" | "coordinator" | "advisor" = "owner",
  org = "demo-org-cristal",
) {
  let now = Date.parse("2026-11-19T12:00:00-05:00"),
    fail = false;
  const library = new LibraryStore({ id: `demo-${role}`, role }, org, {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => {
      if (fail) throw Error("disk");
      data.set(k, v);
    },
    remove: async (k) => {
      data.delete(k);
    },
  });
  const repo = new DemoConversationRepository(),
    store = new StudioStore(library, repo, () => now);
  return {
    data,
    library,
    store,
    repo,
    fail: (v: boolean) => {
      fail = v;
    },
    advance: (days: number) => {
      now += days * 86400000;
    },
    setTime: (v: string) => {
      now = Date.parse(v);
    },
  };
}
test("Usage preserves original Studio 42% and Assistant 34% without credit consumption", async () => {
  const f = setup();
  await f.library.hydrate();
  const initial = f.store.usageStats();
  assert.equal(initial.aiPercent, 42);
  assert.equal(initial.assistantPercent, 34);
  await f.store.assistantAsk("Audita mis agentes");
  assert.deepEqual(f.store.usageStats().data, initial.data);
  assert.equal(
    f.store.usageStats().agentUsage.reduce((n, a) => n + a.used, 0),
    initial.data.used.agents,
  );
});
test("Warning scenario is internally consistent and projects day 24, not a fixed dialog date", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.usageScenario("warning");
  const s = f.store.usageStats();
  assert.equal(s.aiPercent, 80);
  assert.equal(s.projectedDay, 24);
  assert.equal(s.assistantPercent, 34);
  assert.deepEqual(
    s.agentUsage.map((a) => a.used),
    [400, 120],
  );
  f.advance(1);
  assert.equal(f.store.usageStats().projectedDay, 25);
});
test("Usage derives library counts and bytes from shared fake entries, not hardcoded mock totals", async () => {
  const f = setup();
  await f.library.hydrate();
  const s = f.store.usageStats(),
    entries = f.library.snapshot().entries;
  assert.equal(s.people, 3);
  assert.equal(s.documents, entries.filter((e) => e.rag).length);
  const bytes = entries.reduce(
    (n, e) => n + (e.file?.bytes ?? Buffer.byteLength(e.content)),
    0,
  );
  assert.equal(s.storageBytes, bytes);
});
test("Plan request is local, persisted and idempotent under concurrent same or different keys", async () => {
  const f = setup();
  await f.library.hydrate();
  const results = await Promise.all([
    f.store.requestPlan("ultra", "a"),
    f.store.requestPlan("ultra", "a"),
    f.store.requestPlan("ultra", "b"),
  ]);
  assert.equal(new Set(results).size, 1);
  assert.equal(f.store.usageData().requests.length, 1);
  assert.equal(f.store.usageData().plan, "pro");
  const g = setup(f.data);
  await g.library.hydrate();
  assert.equal(g.store.usageData().requests[0]!.id, results[0]);
  assert.equal(g.store.usageData().requests[0]!.status, "pending-local");
  assert.equal(g.store.usageData().plan, "pro");
});
test("Failed plan save leaves no success or partial request; same key retry saves once", async () => {
  const f = setup();
  await f.library.hydrate();
  f.fail(true);
  await assert.rejects(f.store.requestPlan("ultra", "retry"));
  assert.equal(f.store.usageData().requests.length, 0);
  f.fail(false);
  await f.store.requestPlan("ultra", "retry");
  await f.store.requestPlan("ultra", "retry");
  assert.equal(f.store.usageData().requests.length, 1);
});
test("Current and unknown plans are rejected without changing the subscription", async () => {
  const f = setup();
  await f.library.hydrate();
  await assert.rejects(f.store.requestPlan("pro"), /ya es/);
  await assert.rejects(f.store.requestPlan("remote" as never), /disponible/);
  assert.equal(f.store.usageData().requests.length, 0);
});
test("Owner gate and user/org keys isolate plan requests and quota fixtures", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.requestPlan("ultra");
  await f.store.usageScenario("warning");
  for (const role of ["advisor", "coordinator"] as const) {
    const g = setup(f.data, role);
    await g.library.hydrate();
    assert.throws(() => g.store.usageStats(), /perfil/);
    assert.throws(() => g.store.requestPlan("ultra"), /perfil/);
  }
  const g = setup(f.data, "owner", "demo-org-other");
  await g.library.hydrate();
  assert.equal(g.store.usageData().requests.length, 0);
  assert.equal(g.store.usageStats().aiPercent, 42);
});
test("Assistant cap blocks answers without adding messages; general agent routing stays available", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.usageScenario("assistant-blocked");
  await assert.rejects(f.store.assistantAsk("Hola"), /tope/);
  assert.equal(f.store.activeAssistant().turns.length, 0);
  assert.equal(f.store.route("Cliente", "Hola").decision, "reply");
});
test("Organization cap prevents automatic replies independently of the assistant personal cap", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.usageScenario("organization-blocked");
  assert.equal(f.store.usageStats().assistantPercent, 50);
  assert.equal(f.store.route("Cliente", "Hola").decision, "handoff");
  await assert.rejects(f.store.assistantAsk("Hola"), /tope/);
  await f.store.usageScenario("normal");
  assert.equal(f.store.route("Cliente", "Hola").decision, "reply");
});
test("No configured assistant cap blocks answers and uses finite percentages", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.usageScenario("no-assistant-limit");
  assert.equal(f.store.usageStats().assistantBlocked, true);
  assert.equal(f.store.usageStats().assistantPercent, 0);
  await assert.rejects(f.store.assistantAsk("Hola"), /tope/);
});
test("Prompt claims are atomic: concurrent focuses show exactly once", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.usageScenario("warning");
  assert.equal(f.store.usageShouldPrompt(), true);
  const claims = await Promise.all([
    f.store.usageClaimPrompt(),
    f.store.usageClaimPrompt(),
  ]);
  assert.equal(claims.filter((x) => x === "show").length, 1);
  assert.equal(f.store.usageShouldPrompt(), false);
});
test("Prompt default weekly cadence survives restoration", async () => {
  const f = setup();
  f.setTime("2026-11-10T12:00:00-05:00");
  await f.library.hydrate();
  await f.store.usageScenario("warning");
  await f.store.usageClaimPrompt();
  const g = setup(f.data);
  g.setTime("2026-11-10T12:00:00-05:00");
  await g.library.hydrate();
  g.advance(6);
  assert.equal(g.store.usageShouldPrompt(), false);
  g.advance(1);
  assert.equal(g.store.usageShouldPrompt(), true);
  assert.equal(await g.store.usageClaimPrompt(), "show");
});
test("Snooze explicitly overrides weekly cadence after three days, once", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.usageScenario("warning");
  await f.store.usageClaimPrompt();
  await f.store.usageSnooze();
  f.advance(2);
  assert.equal(f.store.usageShouldPrompt(), false);
  f.advance(1);
  assert.equal(f.store.usageShouldPrompt(), true);
  await f.store.usageClaimPrompt();
  assert.equal(f.store.usageShouldPrompt(), false);
});
test("Failed prompt claim never consumes cadence; safe retry succeeds", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.usageScenario("warning");
  f.fail(true);
  await assert.rejects(f.store.usageClaimPrompt());
  assert.equal(f.store.usageShouldPrompt(), true);
  f.fail(false);
  assert.equal(await f.store.usageClaimPrompt(), "show");
});
test("Month rollover resets fictitious quota without losing requests or changing plan", async () => {
  const f = setup();
  await f.library.hydrate();
  await f.store.requestPlan("ultra");
  await f.store.usageScenario("organization-blocked");
  f.setTime("2026-12-01T12:00:00-05:00");
  assert.equal(f.store.usageData().period, "2026-12");
  assert.equal(f.store.usageStats().aiPercent, 42);
  assert.equal(f.store.usageData().requests.length, 1);
  assert.equal(f.store.usageData().plan, "pro");
});
test("Old documents have compatible lazy Usage defaults and no write on read", async () => {
  const f = setup();
  await f.library.hydrate();
  const before = JSON.stringify(f.library.snapshot());
  assert.equal(f.store.doc().usage, undefined);
  f.store.usageStats();
  assert.equal(JSON.stringify(f.library.snapshot()), before);
});
test("Usage validation rejects corrupt percentages, requests and impossible periods", () => {
  const u = usageFixture(Date.parse("2026-11-19T17:00:00Z"));
  validateUsage(u);
  for (const patch of [
    { period: "2026-13" },
    { limit: 0 },
    { assistantLimit: NaN },
    { used: { ...u.used, agents: -1 } },
    { requests: [{ id: "real", plan: "pro", at: 1, status: "paid" }] },
  ])
    assert.throws(() => validateUsage({ ...u, ...patch } as never));
});
test("Projection handles zero consumption and exhausted quota without suggesting impossible dates", () => {
  const now = Date.parse("2026-11-19T17:00:00Z"),
    u = usageFixture(now);
  assert.equal(
    usageSummary({ ...u, used: { agents: 0, creator: 0, assistant: 0 } }, now)
      .early,
    false,
  );
  assert.equal(
    usageSummary(
      { ...u, used: { agents: 1000, creator: 0, assistant: 0 } },
      now,
    ).early,
    false,
  );
});
