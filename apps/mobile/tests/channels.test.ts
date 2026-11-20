import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamRepository } from "../src/features/team/core";
import { ChannelStore } from "../src/features/channels/core";
import { ContactDirectory } from "../src/features/contact/core";
import { DemoConversationRepository } from "../src/features/inbox/model";
import { CatalogStore } from "../src/features/catalog/core";
function fixture(
  actor = "demo-owner",
  org = "demo-org-cristal",
  data = new Map<string, string>(),
) {
  const io = {
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => {
      data.set(k, v);
    },
    remove: async (k: string) => {
      data.delete(k);
    },
  };
  const team = new TeamRepository(org, io),
    a = {
      id: actor,
      role:
        actor === "demo-advisor" ? ("advisor" as const) : ("owner" as const),
    },
    repo = new DemoConversationRepository(
      undefined,
      new CatalogStore(a, org),
      team,
    ),
    directory = new ContactDirectory(a, repo, io, () => {});
  let time = 100;
  const store = new ChannelStore(
    team,
    actor,
    io,
    (p) => directory.applyChannelPolicy(p),
    () => time,
  );
  return {
    store,
    team,
    repo,
    directory,
    io,
    data,
    expire: () => (time += 60000),
  };
}
test("Channels default to disconnected, hidden addon and ads off; no credentials are persisted", async () => {
  const f = fixture();
  await f.store.hydrate();
  assert.equal(f.store.snapshot().doc.status, "disconnected");
  assert.equal(f.store.snapshot().doc.addon, false);
  assert.equal(f.store.snapshot().doc.ads, false);
  assert.equal(JSON.stringify(f.store.snapshot()).includes("token"), false);
});
test("Missing permission, success, cancel and disconnect are local and preserve configuration", async () => {
  const f = fixture();
  await f.store.hydrate();
  await f.store.connect("missing");
  assert.equal(f.store.snapshot().doc.status, "incomplete");
  await f.store.connect("success");
  await f.store.connect("cancel");
  assert.equal(f.store.snapshot().doc.status, "connected");
  await f.store.disconnect();
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  assert.equal(g.store.snapshot().doc.status, "disconnected");
});
test("Direct modes require addon and unexpired simulated device; deactivation returns to Meta", async () => {
  const f = fixture();
  await f.store.hydrate();
  await assert.rejects(f.store.mode("direct"));
  await f.store.addon(true);
  await assert.rejects(f.store.mode("hybrid"));
  f.store.renew();
  f.expire();
  await assert.rejects(f.store.link());
  f.store.renew();
  await f.store.link();
  await f.store.mode("hybrid");
  assert.equal(f.directory.flags().linked, true);
  await f.store.addon(false);
  assert.equal(f.store.snapshot().doc.bulkMode, "meta");
  assert.equal(f.directory.flags().addon, false);
});
test("New defaults preserve existing modes; bulk applies lazily and individual overrides persist", async () => {
  const f = fixture();
  await f.store.hydrate();
  const old = f.directory.get("demo-conv-1");
  await old.hydrate();
  await f.store.addon(true);
  f.store.renew();
  await f.store.link();
  await f.store.mode("direct");
  assert.equal(old.snapshot().data.mode, "meta");
  await f.store.bulk();
  assert.equal(old.snapshot().data.mode, "direct");
  await old.mode("hybrid", "override");
  assert.equal(old.snapshot().data.mode, "hybrid");
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  const restored = g.directory.get("demo-conv-1");
  await restored.hydrate();
  assert.equal(restored.snapshot().data.mode, "hybrid");
  await g.store.mode("meta");
  await g.store.bulk();
  assert.equal(restored.snapshot().data.mode, "meta");
});
test("New contact uses selected default and old untouched document uses latest bulk policy", async () => {
  const f = fixture();
  await f.store.hydrate();
  await f.store.addon(true);
  f.store.renew();
  await f.store.link();
  await f.store.mode("direct");
  const c = f.repo.create(
      f.team.actor("demo-owner"),
      "Muestra",
      "+15550100001",
    ),
    s = f.directory.get(c.id);
  await s.hydrate();
  assert.equal(s.snapshot().data.mode, "direct");
  await f.store.bulk();
  const later = f.directory.get("demo-conv-2");
  await later.hydrate();
  assert.equal(later.snapshot().data.mode, "direct");
});
test("Attribution is off until explicit save; events deduplicate and accept only fake click IDs", async () => {
  const f = fixture();
  await f.store.hydrate();
  await assert.rejects(f.store.report("a", "Lead", "demo-ctwa-1"));
  await f.store.ads(true);
  await f.store.report("a", "Lead", "demo-ctwa-1");
  await f.store.report("a", "Lead", "demo-ctwa-1");
  assert.equal(f.store.snapshot().doc.events.length, 1);
  await assert.rejects(f.store.report("a", "Compra", "demo-ctwa-1"));
  await assert.rejects(f.store.report("b", "Lead", "real-click"));
});
test("Advisor reads effective mode policy but cannot manage; other organizations remain isolated", async () => {
  const f = fixture();
  await f.store.hydrate();
  await f.store.connect("success");
  const a = new ChannelStore(f.team, "demo-advisor", f.io);
  await a.hydrate();
  assert.equal(a.snapshot().ready, true);
  await assert.rejects(a.connect("success"));
  const g = fixture("demo-owner", "demo-org-other", f.data);
  await g.store.hydrate();
  assert.equal(g.store.snapshot().doc.status, "disconnected");
  f.data.set(g.store.key, f.data.get(f.store.key)!);
  const bad = fixture("demo-owner", "demo-org-other", f.data);
  await bad.store.hydrate();
  assert.equal(bad.store.snapshot().ready, false);
});
test("Failed channel save retains state and concurrent edits merge without losing each other", async () => {
  const f = fixture();
  await f.store.hydrate();
  const set = f.io.set;
  f.io.set = async () => {
    throw Error("disk");
  };
  await assert.rejects(f.store.connect("success"));
  assert.equal(f.store.snapshot().doc.status, "disconnected");
  f.io.set = set;
  await Promise.all([f.store.connect("success"), f.store.quality("Baja")]);
  assert.equal(f.store.snapshot().doc.status, "connected");
  assert.equal(f.store.snapshot().doc.quality, "Baja");
});
