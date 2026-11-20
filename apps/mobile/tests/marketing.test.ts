import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamRepository } from "../src/features/team/core";
import { CatalogStore } from "../src/features/catalog/core";

import { DemoConversationRepository } from "../src/features/inbox/model";
import { TemplateStore } from "../src/features/templates/core";
import {
  MarketingStore,
  emptyInput,
  type Input,
} from "../src/features/marketing/core";
import { guardedStorage } from "../src/features/team/guarded-storage";
function fixture(
  id = "demo-owner",
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
    actor = {
      id,
      role:
        id === "demo-advisor"
          ? ("advisor" as const)
          : id === "demo-coordinator"
            ? ("coordinator" as const)
            : ("owner" as const),
    },
    catalog = new CatalogStore(actor, org),
    repo = new DemoConversationRepository(undefined, catalog, team),
    templates = new TemplateStore(team, id, io);
  let now = 1763640000000;
  const store = new MarketingStore(team, id, repo, templates, io, () => now);
  return {
    io,
    data,
    team,
    repo,
    templates,
    store,
    advance: (days = 1) => (now += days * 86400000),
  };
}
const base = async (f: ReturnType<typeof fixture>, optIn = true) => {
  await f.store.hydrate();
  return f.store.importFile(
    "demo-base-csv",
    "Base",
    optIn,
    "telefono",
    "nombre",
    "import",
  );
};
async function draft(
  f: ReturnType<typeof fixture>,
  audience: string,
  template = "promo_2x1",
) {
  const id = await f.store.start(
    audience,
    "start-" + f.store.snapshot().doc.sequence,
  );
  const c = f.store.rawCampaign(id);
  await f.store.saveDraft(
    id,
    { ...c.input, template },
    5,
    c.revision,
    "save-" + id,
  );
  return id;
}
async function confirm(f: ReturnType<typeof fixture>, id: string) {
  const p = f.store.plan(id);
  await f.store.confirm(id, p.signature, String(p.ids.length), "confirm-" + id);
  return p;
}
test("Import maps only sample fields and reports exact invalid and duplicate rows", async () => {
  const f = fixture(),
    id = await base(f),
    a = f.store.audience(id);
  assert.deepEqual(
    [a.created, a.updated, a.duplicates, a.invalid, a.members.length],
    [3, 0, 1, 2, 3],
  );
  assert.deepEqual(
    a.issues.map((i) => i.line),
    [5, 6],
  );
  assert.equal(
    f.repo.get(f.team.actor("demo-owner"), a.members[0]!).name,
    "Ana de prueba",
  );
  assert.equal(
    await f.store.importFile(
      "demo-base-csv",
      "Base",
      true,
      "telefono",
      "nombre",
      "import",
    ),
    id,
  );
});
test("Second import updates shared identities and retains prior audience result history", async () => {
  const f = fixture(),
    id = await base(f),
    first = f.store.audience(id).members[0]!;
  const second = await f.store.importFile(
    "demo-base-xlsx",
    "Segunda",
    true,
    "Movil",
    "Nombre",
    "import2",
  );
  assert.equal(f.store.audience(second).updated, 1);
  assert.equal(f.store.audience(second).created, 2);
  assert.equal(
    f.repo.get(f.team.actor("demo-owner"), first).name,
    "Ana actualizada",
  );
  assert.equal(f.store.audience(id).created, 3);
});
test("Import refuses unknown files, invalid mapping, missing consent and duplicate names", async () => {
  const f = fixture();
  await f.store.hydrate();
  await assert.rejects(
    f.store.importFile("real-file", "Base", true, "telefono", "nombre", "a"),
  );
  await assert.rejects(
    f.store.importFile(
      "demo-base-csv",
      "Base",
      true,
      "telefono",
      "telefono",
      "b",
    ),
  );
  await base(f);
  await assert.rejects(
    f.store.importFile(
      "demo-base-csv",
      "Base",
      true,
      "telefono",
      "nombre",
      "other",
    ),
  );
});
test("Nonconsenting, opted-out and archived contacts are excluded from plans", async () => {
  const f = fixture(),
    a = await base(f, false),
    id = await draft(f, a);
  assert.throws(() => f.store.plan(id), /opt-in/);
  const second = await f.store.importFile(
    "demo-base-xlsx",
    "Consentida",
    true,
    "Movil",
    "Nombre",
    "consent",
  );
  const ids = f.store.audience(second).members;
  f.repo.markOptOut(f.team.actor("demo-owner"), ids[0]!);
  f.repo.archive(f.team.actor("demo-owner"), [ids[1]!]);
  const next = await f.store.start(second, "next");
  const c = f.store.rawCampaign(next);
  await f.store.saveDraft(
    next,
    { ...c.input, template: "promo_2x1" },
    5,
    1,
    "next-save",
  );
  assert.equal(f.store.plan(next).ids.length, 1);
});
test("Wizard persists all five-step fields and refuses stale or foreign editing", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a);
  const c = f.store.rawCampaign(id);
  await assert.rejects(f.store.saveDraft(id, c.input, 3, 1, "stale"));
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  assert.equal(g.store.rawCampaign(id).step, 5);
  assert.equal(g.store.rawCampaign(id).input.audience, a);
  const coord = new MarketingStore(
    f.team,
    "demo-coordinator",
    f.repo,
    new TemplateStore(f.team, "demo-coordinator", f.io),
    f.io,
  );
  await coord.hydrate();
  await assert.rejects(coord.saveDraft(id, c.input, 4, c.revision, "foreign"));
});
test("Confirmation requires exact count and unchanged eligible/template snapshot", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a),
    p = f.store.plan(id);
  await assert.rejects(f.store.confirm(id, p.signature, "999", "bad"));
  f.repo.markOptOut(f.team.actor("demo-owner"), p.ids[0]!);
  await assert.rejects(
    f.store.confirm(id, p.signature, String(p.ids.length), "changed"),
  );
  assert.equal(f.store.rawCampaign(id).status, "draft");
  const next = await confirm(f, id);
  assert.equal(next.ids.length, 2);
  assert.equal(f.store.campaign(id).status, "running");
});
test("Confirmation replay is idempotent, does not enqueue or send and has stable recipients", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a),
    p = await confirm(f, id);
  await f.store.confirm(id, p.signature, String(p.ids.length), "confirm-" + id);
  assert.equal(f.store.campaign(id).recipients.length, 3);
  assert.ok(
    f.store.campaign(id).recipients.every((r) => r.status === "pending"),
  );
  assert.equal(f.store.metrics("month").sent, 0);
});
test("Scheduled simulation advances only manually after due time", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a),
    c = f.store.rawCampaign(id);
  const future = 1763640000000 + 86400000;
  await f.store.saveDraft(
    id,
    { ...c.input, when: "scheduled", scheduledAt: future },
    5,
    c.revision,
    "time",
  );
  await confirm(f, id);
  assert.equal(f.store.campaign(id).status, "scheduled");
  await assert.rejects(f.store.advance(id, "delivered", "early"), /todavía/);
  f.advance();
  await f.store.advance(id, "delivered", "due");
  assert.equal(f.store.metrics("month").sent, 1);
});
test("Manual outcomes preserve funnel invariants, costs and stable replay", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a);
  await confirm(f, id);
  await f.store.advance(id, "replied", "one");
  await f.store.advance(id, "replied", "one");
  await f.store.advance(id, "read", "two");
  await f.store.advance(id, "delivered", "three");
  assert.equal(f.store.campaign(id).status, "done");
  assert.deepEqual(f.store.metrics("month"), {
    sent: 3,
    delivered: 3,
    read: 2,
    replied: 1,
    failed: 0,
    skipped: 0,
    cents: 240,
  });
  assert.equal(f.store.metrics("month", true).cents, 216);
});
test("Failures stop strictly above the configured safety threshold and cancellation preserves history", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a);
  await confirm(f, id);
  await f.store.advance(id, "failed", "one");
  assert.equal(f.store.campaign(id).status, "paused");
  await assert.rejects(f.store.advance(id, "delivered", "no"));
  const c = f.store.campaign(id);
  await f.store.control(id, "cancel", c.revision, "cancel");
  assert.equal(f.store.campaign(id).status, "cancelled");
  assert.equal(f.store.campaign(id).recipients[0]!.status, "failed");
  assert.ok(
    f.store
      .campaign(id)
      .recipients.slice(1)
      .every((r) => r.status === "cancelled"),
  );
});
test("Pausing a template blocks simulation and reapproval requires explicit resume", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a);
  await confirm(f, id);
  await f.templates.review("promo_2x1", "paused", "", 1);
  assert.equal(f.store.campaign(id).status, "paused");
  await f.store.advance(id, "delivered", "stop");
  assert.equal(f.store.rawCampaign(id).status, "paused");
  assert.equal(f.store.metrics("month").sent, 0);
  await assert.rejects(
    f.store.control(id, "resume", f.store.rawCampaign(id).revision, "bad"),
  );
  await f.templates.review("promo_2x1", "approved", "", 2);
  await f.store.control(
    id,
    "resume",
    f.store.rawCampaign(id).revision,
    "resume",
  );
  await f.store.advance(id, "read", "ok");
  assert.equal(f.store.metrics("month").sent, 1);
});
test("Baja or opt-in change after confirmation is rechecked before each manual result", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a),
    p = await confirm(f, id);
  f.repo.markOptOut(f.team.actor("demo-owner"), p.ids[0]!);
  await f.store.advance(id, "delivered", "one");
  assert.equal(f.store.campaign(id).recipients[0]!.status, "skipped");
  assert.equal(f.store.metrics("month").sent, 0);
});
test("Marketing frequency spans campaigns but utility is not restricted by marketing cooldown", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a);
  await confirm(f, id);
  await f.store.advance(id, "delivered", "one");
  const next = await draft(f, a);
  assert.equal(f.store.plan(next).ids.length, 2);
  const utility = await draft(f, a, "recordatorio_cita");
  assert.equal(f.store.plan(utility).ids.length, 3);
  f.advance(7);
  assert.equal(f.store.plan(next).ids.length, 3);
});
test("Duplicate creates a new draft and never copies delivery results", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a);
  await confirm(f, id);
  await f.store.advance(id, "read", "one");
  const next = await f.store.duplicate(id, "copy");
  assert.notEqual(next, id);
  assert.equal(f.store.campaign(next).status, "draft");
  assert.equal(f.store.campaign(next).recipients.length, 0);
  assert.equal(f.store.campaign(next).creator, "demo-owner");
  assert.equal(f.store.usage("promo_2x1"), 2);
});
test("Role and organization isolation include documents, settings and receipts", async () => {
  const f = fixture(),
    a = await base(f);
  const adv = fixture("demo-advisor", "demo-org-cristal", f.data);
  await adv.store.hydrate();
  assert.equal(adv.store.snapshot().ready, false);
  await assert.rejects(adv.store.start(a, "one"));
  const other = fixture("demo-owner", "demo-org-other", f.data);
  await other.store.hydrate();
  assert.equal(other.store.audiences().length, 0);
  f.data.set(other.store.key, f.data.get(f.store.key)!);
  const forged = fixture("demo-owner", "demo-org-other", f.data);
  await forged.store.hydrate();
  assert.equal(forged.store.snapshot().ready, false);
});
test("Concurrent import serializes uniqueness; failed storage keeps prior document", async () => {
  const f = fixture();
  await f.store.hydrate();
  const jobs = await Promise.allSettled([
    f.store.importFile(
      "demo-base-csv",
      "Base",
      true,
      "telefono",
      "nombre",
      "a",
    ),
    f.store.importFile(
      "demo-base-csv",
      "Base",
      true,
      "telefono",
      "nombre",
      "b",
    ),
  ]);
  assert.equal(jobs.filter((r) => r.status === "fulfilled").length, 1);
  const set = f.io.set;
  f.io.set = async () => {
    throw Error("disk");
  };
  await assert.rejects(f.store.start(undefined, "failed"));
  assert.equal(f.store.campaigns().length, 0);
  f.io.set = set;
  await f.store.start(undefined, "failed");
  assert.equal(f.store.campaigns().length, 1);
});
test("Settings validate bounds, use revision conflicts and preserve estimated cents", async () => {
  const f = fixture();
  await f.store.hydrate();
  const d = f.store.snapshot().doc;
  await assert.rejects(
    f.store.configure({ ...d.settings, threshold: 0 }, d.revision, "bad"),
  );
  await f.store.configure(
    { ...d.settings, frequencyDays: 3, marketingCents: 95 },
    d.revision,
    "good",
  );
  await assert.rejects(f.store.configure(d.settings, d.revision, "stale"));
  assert.equal(f.store.snapshot().doc.settings.marketingCents, 95);
});
test("Shared projection preserves in-session edits; a new repository restores stable IDs from the import snapshot", async () => {
  const f = fixture(),
    a = await base(f),
    id = f.store.audience(a).members[0]!;
  f.repo.editIdentity(
    f.team.actor("demo-owner"),
    id,
    "Cambio manual",
    "+15550108001",
  );
  await f.store.start(a, "just-draft");
  assert.equal(
    f.repo.get(f.team.actor("demo-owner"), id).name,
    "Cambio manual",
  );
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  assert.equal(g.store.audience(a).members[0], id);
  assert.equal(
    g.repo.get(g.team.actor("demo-owner"), id).name,
    "Ana de prueba",
  );
});
test("Role revocation during pending import rolls back guarded bytes and cannot publish contacts", async () => {
  const f = fixture();
  await f.team.hydrate();
  const t = new TemplateStore(f.team, "demo-coordinator", f.io),
    store = new MarketingStore(
      f.team,
      "demo-coordinator",
      f.repo,
      t,
      guardedStorage(f.team, "demo-coordinator", f.io),
    );
  await store.hydrate();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r)),
    set = f.io.set;
  f.io.set = async (k, v) => {
    if (k === store.key) {
      entered();
      await gate;
    }
    await set(k, v);
  };
  const pending = store.importFile(
    "demo-base-csv",
    "Base",
    true,
    "telefono",
    "nombre",
    "one",
  );
  await started;
  await f.team.update(
    "demo-owner",
    "demo-coordinator",
    { role: "coordinator", active: false, receiveNew: false, expected: 1 },
    "off",
  );
  release();
  await assert.rejects(pending);
  assert.equal(f.data.has(store.key), false);
  assert.equal(store.snapshot().doc.people.length, 0);
});

test("Disabled Marketing denies pending management while approved Chat templates remain usable", async () => {
  const f = fixture();
  let enabled = true;
  const t = new TemplateStore(f.team, "demo-owner", f.io, () => enabled),
    s = new MarketingStore(
      f.team,
      "demo-owner",
      f.repo,
      t,
      f.io,
      Date.now,
      () => enabled,
    );
  await s.hydrate();
  enabled = false;
  await assert.rejects(s.start(undefined, "denied"), /deshabilitado/);
  await assert.rejects(t.review("promo_2x1", "paused", "", 1), /deshabilitado/);
  assert.ok(t.render("promo_2x1", ["Ana"]));
  assert.equal(s.snapshot().doc.campaigns.length, 0);
});
test("Partial identity conflicts in projected imports cannot mutate prior contacts", async () => {
  const f = fixture();
  await f.team.hydrate();
  const actor = f.team.actor("demo-owner"),
    original = f.repo.get(actor, "demo-conv-1");
  assert.throws(() =>
    f.repo.importFictitiousBatch(actor, [
      {
        id: "demo-new-815550108001",
        phone: "+15550108001",
        name: "Muestra",
        creator: "demo-owner",
        updateName: true,
      },
      {
        id: original.id,
        phone: "+15550108002",
        name: "Conflicto",
        creator: "demo-owner",
        updateName: true,
      },
    ]),
  );
  assert.equal(
    f.repo.list(actor).some((c) => c.id === "demo-new-815550108001"),
    false,
  );
});

test("Persisted STOP for an imported identity survives a fresh Inbox and is rechecked before confirmation", async () => {
  const { OptOutStore } = await import("../src/features/optout/core");
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a),
    oldPlan = f.store.plan(id),
    person = oldPlan.ids[0]!;
  const opt = new OptOutStore(f.team, "demo-owner", f.io);
  await opt.hydrate();
  await opt.simulate("stop-imported", person, "STOP");
  await assert.rejects(
    f.store.confirm(id, oldPlan.signature, "3", "stale-consent"),
  );
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  assert.equal(g.repo.get(g.team.actor("demo-owner"), person).optedOut, true);
  assert.equal(g.store.plan(id).ids.length, 2);
});

test("Metrics use the business calendar and historical rates, independent from later configuration", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a);
  await confirm(f, id);
  await f.store.advance(id, "read", "one");
  const d = f.store.snapshot().doc;
  await f.store.configure(
    { ...d.settings, marketingCents: 95 },
    d.revision,
    "tariff",
  );
  assert.equal(f.store.metrics("month").cents, 80);
  assert.equal(f.store.campaignsForPeriod("month").length, 1);
  f.advance(40);
  assert.equal(f.store.metrics("30").sent, 0);
  assert.equal(f.store.campaignsForPeriod("month").length, 0);
});

test("Unknown campaign actions and restored transport/credential fields fail closed", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a);
  await confirm(f, id);
  await assert.rejects(
    f.store.control(
      id,
      "delete" as never,
      f.store.campaign(id).revision,
      "unknown",
    ),
  );
  const raw = JSON.parse(f.data.get(f.store.key)!);
  raw.sendEnabled = true;
  const bytes = JSON.stringify(raw);
  f.data.set(f.store.key, bytes);
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  assert.equal(g.store.snapshot().ready, false);
  assert.equal(f.data.get(g.store.key), bytes);
});

test("Audience-by-tag reads the shared contact catalog rather than an independent recipient list", async () => {
  const f = fixture(),
    a = await base(f),
    id = await draft(f, a),
    person = f.store.audience(a).members[0]!;
  await f.repo.catalog.hydrate();
  f.repo.updateContact(f.team.actor("demo-owner"), person, { tags: ["VIP"] });
  const c = f.store.rawCampaign(id);
  await f.store.saveDraft(
    id,
    { ...c.input, source: "tag", tag: "VIP" },
    5,
    c.revision,
    "tag-source",
  );
  assert.deepEqual(f.store.plan(id).ids, [person]);
});
