import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ResultsStore,
  businessDay,
  resultsRange,
  summarizeResults,
  resultsFixtures,
  validateResultsQuery,
} from "../src/features/results/core";
const owner = { id: "demo-owner", role: "owner" } as const;
const now = Date.parse("2026-11-19T12:00:00-05:00");
const setup = () => new ResultsStore(owner, now);
test("results 30-day ledger computes approved sample values rather than unrelated static cards", () => {
  const s = setup(),
    m = s.summary();
  assert.equal(m.prospects, 38);
  assert.equal(m.money, 2620000);
  assert.equal(m.won, 9);
  assert.equal(m.openMoney, 6390000);
  assert.equal(m.closeRate, 24);
  assert.equal(m.averageTicket, 291111);
  assert.equal(m.ai, 174);
  assert.equal(m.handoffs, 38);
  assert.equal(m.responseSeconds, 120);
  assert.equal(m.appointments, 19);
  assert.equal(m.cancellations, 3);
  assert.equal(m.attendance, 86);
  assert.equal(m.ads, 21);
  assert.equal(m.organic, 17);
});
test("business period uses Cancun midnight regardless of device timezone", () => {
  assert.equal(businessDay(Date.parse("2026-11-20T03:00:00Z")), "2026-11-19");
  assert.deepEqual(resultsRange("7", "2026-03-02"), {
    from: "2026-02-24",
    to: "2026-03-02",
  });
  assert.equal(resultsRange("month", "2024-02-29").from, "2024-02-01");
});
test("advisor is denied read, period, filter, tab and demo status mutations", () => {
  const s = new ResultsStore({ id: "demo-advisor", role: "advisor" }, now);
  for (const f of [
    () => s.summary(),
    () => s.comparison(),
    () => s.period("7"),
    () => s.apply({ ...resultsRange("7", s.today), assignee: null }),
    () => s.tab("care"),
    () => s.status("normal"),
  ])
    assert.throws(f, /perfil/);
});
test("coordinator may inspect team analytics and per-person data", () => {
  const s = new ResultsStore(
    { id: "demo-coordinator", role: "coordinator" },
    now,
  );
  assert.equal(s.canRead, true);
  s.apply({ ...s.snapshot().query, assignee: "demo-advisor" });
  assert.ok(s.summary().prospects > 0);
  assert.ok(s.summary().prospects < 38);
});
test("sum of scoped team totals equals team ledger; same range applies to all sections", () => {
  const s = setup(),
    all = s.summary();
  const people = ["demo-owner", "demo-coordinator", "demo-advisor"];
  let total = 0,
    won = 0,
    money = 0;
  for (const assignee of people) {
    s.apply({ ...s.snapshot().query, assignee });
    const m = s.summary();
    total += m.prospects;
    won += m.won;
    money += m.money;
    s.tab("care");
    assert.equal(s.summary().prospects, m.prospects);
  }
  assert.equal(total, all.prospects);
  assert.equal(won, all.won);
  assert.equal(money, all.money);
});
test("invalid custom date/filter never replaces the applied query", () => {
  const s = setup(),
    before = s.snapshot();
  for (const q of [
    { from: "2026-02-30", to: "2026-03-01", assignee: null },
    { from: "2026-12-01", to: "2026-11-01", assignee: null },
    { from: "2020-01-01", to: "2026-01-01", assignee: null },
    { from: "2026-01-01", to: "2026-01-05", assignee: "inactive-person" },
  ])
    assert.throws(() => s.apply(q));
  assert.equal(s.snapshot(), before);
});
test("no facts produce no invented averages, percentages or NaN", () => {
  const m = summarizeResults([], {
    from: "2026-01-01",
    to: "2026-01-02",
    assignee: null,
  });
  assert.equal(m.averageTicket, 0);
  assert.equal(m.closeRate, 0);
  assert.equal(m.attendance, null);
  assert.equal(m.responseSeconds, null);
  assert.ok(!JSON.stringify(m).includes("NaN"));
});
test("custom range includes both calendar boundaries and excludes adjacent dates", () => {
  const facts = resultsFixtures("2026-11-19"),
    q = { from: "2026-11-19", to: "2026-11-19", assignee: null };
  assert.equal(summarizeResults(facts, q).prospects, 2);
  assert.equal(summarizeResults(facts, q).money, 290000);
  validateResultsQuery(q);
});
test("range/assignee/tab and independent scroll positions survive navigation without emissions per scroll", () => {
  const s = setup();
  let emissions = 0;
  s.subscribe(() => emissions++);
  s.period("7");
  s.rememberOffset(430);
  s.tab("origin");
  s.rememberOffset(120);
  s.tab("sales");
  assert.equal(s.offset(), 430);
  assert.equal(s.snapshot().period, "7");
  assert.equal(emissions, 3);
  s.rememberOffset(NaN);
  assert.equal(s.offset(), 430);
});
test("loading, offline, empty and recovery do not erase filters or simulate network requests", () => {
  const s = setup();
  s.period("7");
  const q = s.snapshot().query,
    normal = s.summary();
  s.status("offline");
  assert.deepEqual(s.summary(), normal);
  s.status("empty");
  assert.equal(s.summary().prospects, 0);
  s.status("normal");
  assert.deepEqual(s.summary(), normal);
  assert.equal(s.snapshot().query, q);
});
test("previous equivalent period and lower calendar boundary are safe; zero previous values stay zero", () => {
  const s = setup();
  s.period("7");
  assert.ok(s.comparison().prospects > 0);
  s.apply({ from: "2000-01-01", to: "2000-01-02", assignee: null });
  assert.equal(s.comparison().prospects, 0);
});
test("facts/snapshots immutable and subscriber failures isolated", () => {
  const s = setup();
  assert.ok(Object.isFrozen(s.facts));
  assert.ok(s.facts.every(Object.isFrozen));
  assert.ok(Object.isFrozen(s.snapshot().query));
  s.subscribe(() => {
    throw Error("observer");
  });
  s.period("7");
  assert.equal(s.snapshot().period, "7");
});
