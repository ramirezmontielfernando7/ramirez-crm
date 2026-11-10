import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import {
  DemoConversationRepository,
  seedConversations,
  defaultFilters,
  queryConversations,
} from "../src/features/inbox/model";
import { InboxStore } from "../src/features/inbox/store-core";
const owner = { id: "demo-owner", role: "owner" } as const,
  advisor = { id: "demo-advisor", role: "advisor" } as const;
test("2000 synthetic records have unique stable IDs; normalized search covers accent, phone and tags", () => {
  const data = seedConversations();
  assert.equal(data.length, 2000);
  assert.equal(new Set(data.map((c) => c.id)).size, 2000);
  for (const query of ["karla mendez", "525555500142", "promo nov"])
    assert.ok(
      queryConversations(data, owner, { ...defaultFilters, query }).some(
        (c) => c.id === "demo-conv-1",
      ),
    );
});
test("repository enforces advisor scope for reads and atomic bulk mutations", () => {
  const r = new DemoConversationRepository();
  assert.ok(r.list(advisor).every((c) => c.assigned === advisor.id));
  assert.throws(() => r.get(advisor, "demo-conv-1"));
  assert.throws(() => r.archive(advisor, ["demo-conv-3", "demo-conv-1"]));
  assert.equal(r.get(owner, "demo-conv-3").archived, false);
  assert.throws(() => r.assign(advisor, ["demo-conv-3"], "demo-owner"));
  assert.throws(() => r.assign(owner, ["demo-conv-1"], "invalid"));
});
test("combined filters, archive and assignment affect only expected records; unchanged records preserve identity", () => {
  const r = new DemoConversationRepository();
  const before = r.get(owner, "demo-conv-2");
  r.archive(owner, ["demo-conv-1"]);
  assert.ok(
    queryConversations(r.list(owner), owner, {
      ...defaultFilters,
      chip: "Archivados",
    }).some((c) => c.id === "demo-conv-1"),
  );
  assert.ok(
    !queryConversations(r.list(owner), owner, defaultFilters).some(
      (c) => c.id === "demo-conv-1",
    ),
  );
  assert.equal(r.get(owner, "demo-conv-2"), before);
  r.archive(owner, ["demo-conv-1"]);
  r.assign(owner, ["demo-conv-1"], "demo-advisor");
  assert.ok(r.list(advisor).some((c) => c.id === "demo-conv-1"));
  const filters = {
    ...defaultFilters,
    stage: "Interesado",
    tag: "Promo nov",
    who: "Míos",
  };
  assert.equal(queryConversations(r.list(owner), advisor, filters).length, 1);
});
test("campaign response moves exactly one conversation into clients", () => {
  const r = new DemoConversationRepository();
  const c = r.list(owner).find((c) => c.campaign)!;
  r.incoming(owner, c.id);
  assert.equal(r.get(owner, c.id).unread, c.unread + 1);
  assert.ok(
    queryConversations(r.list(owner), owner, defaultFilters).some(
      (x) => x.id === c.id,
    ),
  );
  assert.ok(
    !queryConversations(r.list(owner), owner, {
      ...defaultFilters,
      chip: "Campañas",
    }).some((x) => x.id === c.id),
  );
});
test("new contact validates input, avoids duplicates and cannot reveal out-of-scope contacts", () => {
  const r = new DemoConversationRepository();
  assert.throws(() => r.create(advisor, "", "12"));
  assert.throws(() => r.create(advisor, "Persona", "12"));
  assert.throws(() => r.create(advisor, "Karla", "+52 55 5550 0142"));
  const c = r.create(advisor, "Ficticio", "+52 55 5555 9999");
  assert.equal(c.assigned, advisor.id);
  assert.equal(c.closed, true);
  assert.equal(r.create(advisor, "Ficticio", "+52 55 5555 9999").id, c.id);
});
test("scroll updates do not notify; navigation snapshot retains filters and selection; filter changes reset offset", () => {
  const s = new InboxStore(owner);
  let notifications = 0;
  s.subscribe(() => notifications++);
  s.offset = 1700;
  assert.equal(notifications, 0);
  s.toggle("demo-conv-1");
  s.patch({ searching: true });
  assert.equal(s.offset, 1700);
  assert.ok(s.snapshot().selected.has("demo-conv-1"));
  s.filter({ query: "karla" });
  assert.equal(s.offset, 0);
  assert.ok(s.snapshot().selected.has("demo-conv-1"));
  const next = new InboxStore(advisor);
  assert.equal(next.snapshot().selected.size, 0);
});
test("search benchmark on 10000 records (CPU only, no FPS claim)", () => {
  const data = seedConversations(10000);
  const times = [];
  for (let i = 0; i < 60; i++) {
    const start = performance.now();
    queryConversations(data, owner, { ...defaultFilters, query: "prueba 099" });
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      benchmark: "query-10000",
      samples: times.length,
      p50_ms: times[30],
      p95_ms: times[57],
    }),
  );
  assert.equal(data.length, 10000);
});
test("offline event catch-up changes cached records only on explicit reconnect", () => {
  const s = new InboxStore(owner);
  const c = s.snapshot().data.find((c) => c.campaign)!;
  s.patch({ status: "offline" });
  s.incoming(c.id);
  assert.equal(s.repository.get(owner, c.id), c);
  s.reconnect();
  assert.equal(s.repository.get(owner, c.id).campaign, null);
  assert.equal(s.snapshot().status, "normal");
  s.reconnect();
  assert.equal(s.repository.get(owner, c.id).unread, c.unread + 1);
});
