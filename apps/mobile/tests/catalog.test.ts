import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CatalogStore,
  initialTags,
  initialReasons,
  importTag,
  tagPalette,
} from "../src/features/catalog/core";
import { tagColors, tagContrast } from "../src/features/catalog/palette";
import { InboxStore } from "../src/features/inbox/store-core";
import { ContactDirectory } from "../src/features/contact/core";
import { CrmModel } from "../src/features/crm/core";
import { DemoConversationRepository } from "../src/features/inbox/model";
import { dark, light } from "../src/theme/tokens";
function setup(
  data = new Map<string, string>(),
  role: "owner" | "coordinator" | "advisor" = "owner",
  org = "demo-org-cristal",
  io?: ReturnType<typeof port>,
) {
  const storage = io ?? port(data),
    actor = { id: `demo-${role}`, role },
    catalog = new CatalogStore(actor, org, storage),
    inbox = new InboxStore(actor, catalog),
    repo = inbox.repository,
    dir = new ContactDirectory(actor, repo, storage, inbox.reload),
    crm = new CrmModel(actor, repo, inbox.reload);
  return {
    data,
    storage,
    actor,
    catalog,
    inbox,
    repo,
    dir,
    crm,
    ready: () => catalog.hydrate(),
  };
}
function port(data: Map<string, string>) {
  return {
    failRead: false,
    failWrite: false,
    get: async function (k: string) {
      if (this.failRead) throw Error("read");
      return data.get(k) ?? null;
    },
    set: async function (k: string, v: string) {
      if (this.failWrite) throw Error("disk");
      data.set(k, v);
    },
    remove: async (k: string) => {
      data.delete(k);
    },
  };
}
const save = (f: ReturnType<typeof setup>, name = "Nueva", key = "new") =>
  f.catalog.saveTag({ id: null, name, color: "#4338ca", expected: null }, key);
test("Catalog restores approved default tags/reasons without writing or changing B tokens", async () => {
  const f = setup();
  await f.ready();
  assert.deepEqual(f.catalog.tagNames(), initialTags);
  assert.deepEqual(f.catalog.reasonNames(), initialReasons);
  assert.equal(f.data.size, 0);
  assert.ok(f.catalog.tag(importTag)?.automatic);
});
test("Creating tag feeds Inbox filters, contact selection and CRM bulk from the same source", async () => {
  const f = setup();
  await f.ready();
  await save(f);
  const s = f.dir.get("demo-conv-1");
  await s.hydrate();
  await s.tags(["Nueva"]);
  assert.deepEqual(f.repo.get(f.actor, s.id).tags, ["Nueva"]);
  f.crm.patch({ selected: new Set(["demo-conv-2"]) });
  f.crm.bulk("tag", "Nueva");
  assert.ok(f.repo.get(f.actor, "demo-conv-2").tags.includes("Nueva"));
});
test("Rename retains stable identity, normalizes assignments, search and active filters", async () => {
  const f = setup();
  await f.ready();
  f.inbox.filter({ tag: "Promo nov" });
  const t = f.catalog.tag("Promo nov")!;
  await f.catalog.saveTag({
    id: t.id,
    name: "Promoción nueva",
    color: t.color,
    expected: t.revision,
  });
  assert.equal(f.catalog.tag("Promo nov")?.id, t.id);
  assert.equal(f.repo.get(f.actor, "demo-conv-1").tags[0], "Promoción nueva");
  assert.equal(f.inbox.snapshot().filters.tag, "Promoción nueva");
  assert.match(f.repo.get(f.actor, "demo-conv-1").search, /promocionnueva/);
});
test("Only conversations containing changed tag receive new identity; color edits also propagate", async () => {
  const f = setup();
  await f.ready();
  const before = f.repo.get(f.actor, "demo-conv-1"),
    other = f.repo.get(f.actor, "demo-conv-2"),
    t = f.catalog.tag("Promo nov")!;
  await f.catalog.saveTag({
    id: t.id,
    name: t.name,
    color: "#d94a4a",
    expected: t.revision,
  });
  assert.notEqual(f.repo.get(f.actor, before.id), before);
  assert.equal(f.repo.get(f.actor, other.id), other);
});
test("Persisted old contact label resolves through rename aliases after restart", async () => {
  const f = setup();
  await f.ready();
  const s = f.dir.get("demo-conv-1");
  await s.hydrate();
  await s.tags(["VIP"]);
  const t = f.catalog.tag("VIP")!;
  await f.catalog.saveTag({
    id: t.id,
    name: "Preferente",
    color: t.color,
    expected: t.revision,
  });
  const g = setup(f.data);
  await g.ready();
  const restored = g.dir.get(s.id);
  await restored.hydrate();
  assert.equal(restored.snapshot().ready, true);
  assert.deepEqual(restored.snapshot().data.tags, ["Preferente"]);
  assert.deepEqual(g.repo.get(g.actor, s.id).tags, ["Preferente"]);
});
test("Case-only rename keeps old persisted aliases valid", async () => {
  const f = setup();
  await f.ready();
  const t = f.catalog.tag("VIP")!;
  await f.catalog.saveTag({
    id: t.id,
    name: "Vip",
    color: t.color,
    expected: t.revision,
  });
  assert.ok(f.catalog.knownTag("VIP"));
  assert.equal(f.catalog.tag("VIP")?.name, "Vip");
  const g = setup(f.data);
  await g.ready();
  assert.equal(g.catalog.snapshot().ready, true);
});
test("Delete removes assignments, resets obsolete filter and cannot revive historical names", async () => {
  const f = setup();
  await f.ready();
  f.inbox.filter({ tag: "Promo nov" });
  const t = f.catalog.tag("Promo nov")!;
  await f.catalog.removeTag(t.id, t.revision);
  assert.equal(f.catalog.tag("Promo nov"), null);
  assert.equal(f.inbox.snapshot().filters.tag, "Toda etiqueta");
  assert.equal(f.repo.get(f.actor, "demo-conv-1").tags.length, 0);
  await assert.rejects(save(f, "Promo nov"), /histórico/);
});
test("Merging automatic tag remaps assignments without duplicates and survives restore", async () => {
  const f = setup();
  await f.ready();
  const s = f.dir.get("demo-conv-3");
  await s.hydrate();
  await s.tags(["VIP", importTag]);
  const from = f.catalog.tag(importTag)!,
    to = f.catalog.tag("VIP")!;
  await f.catalog.mergeTag(from.id, to.id, from.revision, to.revision, "merge");
  await f.catalog.mergeTag(from.id, to.id, from.revision, to.revision, "merge");
  assert.deepEqual(f.repo.get(f.actor, s.id).tags, ["VIP"]);
  const g = setup(f.data);
  await g.ready();
  const next = g.dir.get(s.id);
  await next.hydrate();
  assert.deepEqual(next.snapshot().data.tags, ["VIP"]);
});
test("System tag cannot be renamed/deleted; invalid and circular merge destinations rejected", async () => {
  const f = setup();
  await f.ready();
  const t = f.catalog.tag(importTag)!;
  await assert.rejects(f.catalog.removeTag(t.id, t.revision), /sistema/);
  await assert.rejects(
    f.catalog.saveTag({
      id: t.id,
      name: "Manual",
      color: t.color,
      expected: t.revision,
    }),
    /cambió/,
  );
  await assert.rejects(
    f.catalog.mergeTag(t.id, t.id, t.revision, t.revision),
    /fusión/,
  );
});
test("Failed tag save leaves assignments intact and idempotent retry writes once", async () => {
  const f = setup();
  await f.ready();
  const t = f.catalog.tag("VIP")!,
    before = f.repo.list(f.actor);
  f.storage.failWrite = true;
  const input = {
    id: t.id,
    name: "Renombrada",
    color: t.color,
    expected: t.revision,
  };
  await assert.rejects(f.catalog.saveTag(input, "retry"));
  assert.deepEqual(f.repo.list(f.actor), before);
  f.storage.failWrite = false;
  await f.catalog.saveTag(input, "retry");
  const seq = f.catalog.snapshot().doc.sequence;
  await f.catalog.saveTag(input, "retry");
  assert.equal(f.catalog.snapshot().doc.sequence, seq);
});
test("Catalog actions validate color, blank/long names and Unicode-equivalent duplicates", async () => {
  const f = setup();
  await f.ready();
  await save(f, "Cotización");
  await assert.rejects(save(f, "cotizacion", "other"), /histórico/);
  await assert.rejects(save(f, " ", "empty"));
  await assert.rejects(save(f, "x".repeat(61), "long"));
  await assert.rejects(
    f.catalog.saveTag({ id: null, name: "No", color: "red", expected: null }),
  );
});
test("Queued tag input is immutable and concurrent same operation is replay-safe", async () => {
  const f = setup();
  await f.ready();
  const input = {
    id: null,
    name: "Original",
    color: "#4338ca",
    expected: null,
  };
  const a = f.catalog.saveTag(input, "a"),
    b = f.catalog.saveTag({ ...input }, "a");
  input.name = "Cambiada";
  assert.equal(await a, await b);
  assert.ok(f.catalog.tag("Original"));
  assert.equal(f.catalog.tag("Cambiada"), null);
});
test("Concurrent instances serialize uniqueness and stale edits never overwrite", async () => {
  const f = setup(),
    g = setup(f.data, "coordinator", "demo-org-cristal", f.storage);
  await Promise.all([f.ready(), g.ready()]);
  const result = await Promise.allSettled([
    save(f, "Única", "f"),
    save(g, "Unica", "g"),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const t = f.catalog.tag("VIP")!;
  await f.catalog.saveTag({
    id: t.id,
    name: "VIP2",
    color: t.color,
    expected: 1,
  });
  await assert.rejects(
    g.catalog.saveTag({
      id: t.id,
      name: "Atrasada",
      color: t.color,
      expected: 1,
    }),
    /cambió/,
  );
  await g.catalog.reload();
  assert.ok(g.catalog.tagNames().includes("VIP2"));
});
test("Advisor cannot manage; coordinator can manage; organizations do not share catalogs", async () => {
  const f = setup();
  await f.ready();
  await save(f);
  const g = setup(f.data, "advisor");
  await g.ready();
  assert.ok(g.catalog.tag("Nueva"));
  await assert.rejects(save(g, "No"), /perfil/);
  const c = setup(f.data, "coordinator");
  await c.ready();
  await save(c, "Coord", "c");
  const other = setup(f.data, "owner", "demo-org-other");
  await other.ready();
  assert.equal(other.catalog.tag("Nueva"), null);
});
test("Stale selected tag names cannot be applied after rename", async () => {
  const f = setup();
  await f.ready();
  const s = f.dir.get("demo-conv-1");
  await s.hydrate();
  const t = f.catalog.tag("VIP")!;
  await f.catalog.saveTag({
    id: t.id,
    name: "Preferente",
    color: t.color,
    expected: 1,
  });
  await assert.rejects(s.tags(["VIP"]), /válidas/);
  assert.throws(
    () => f.repo.updateContact(f.actor, s.id, { tags: ["VIP"] }),
    /válida/,
  );
});
test("New loss reasons are offered consistently by CRM and Chat", async () => {
  const f = setup();
  await f.ready();
  await f.catalog.saveReason({
    id: null,
    name: "Sin cobertura",
    expected: null,
  });
  const s = f.dir.get("demo-conv-1");
  await s.hydrate();
  await s.stage("Perdido", "Sin cobertura");
  assert.equal(f.crm.get(s.id).loss, "Sin cobertura");
  f.crm.move("demo-conv-2", "Perdido", "Sin cobertura");
  const c = f.dir.get("demo-conv-2");
  await c.hydrate();
  assert.equal(c.snapshot().data.lossReason, "Sin cobertura");
});
test("Deactivation removes reason from new deals and retains historical labels and events", async () => {
  const f = setup();
  await f.ready();
  const s = f.dir.get("demo-conv-1");
  await s.hydrate();
  await s.stage("Perdido", "Precio");
  const history = s.snapshot().data.events,
    t = f.catalog.snapshot().doc.reasons[0]!;
  await f.catalog.deactivateReason(t.id, t.revision);
  assert.equal(f.catalog.reasonNames().includes("Precio"), false);
  assert.equal(s.snapshot().data.lossReason, "Precio");
  assert.deepEqual(s.snapshot().data.events, history);
  const other = f.dir.get("demo-conv-2");
  await other.hydrate();
  await assert.rejects(other.stage("Perdido", "Precio"), /motivo/);
  assert.throws(() => f.crm.move("demo-conv-2", "Perdido", "Precio"), /motivo/);
  await s.stage("Perdido", "Precio", "Detalle adicional");
});
test("Reason rename preserves history and remains valid when restoring old contact data", async () => {
  const f = setup();
  await f.ready();
  const s = f.dir.get("demo-conv-1");
  await s.hydrate();
  await s.stage("Perdido", "Precio");
  const t = f.catalog.snapshot().doc.reasons[0]!;
  await f.catalog.saveReason({
    id: t.id,
    name: "Fuera de presupuesto",
    expected: t.revision,
  });
  assert.equal(s.snapshot().data.lossReason, "Precio");
  const g = setup(f.data);
  await g.ready();
  const restored = g.dir.get(s.id);
  await restored.hydrate();
  assert.equal(restored.snapshot().data.lossReason, "Precio");
  assert.ok(g.catalog.reasonNames().includes("Fuera de presupuesto"));
});
test("Otro is fixed and cannot be renamed/deactivated; duplicates in reasons rejected", async () => {
  const f = setup();
  await f.ready();
  const r = f.catalog.snapshot().doc.reasons.find((r) => r.fixed)!;
  await assert.rejects(
    f.catalog.saveReason({ id: r.id, name: "Otra", expected: r.revision }),
    /fijo/,
  );
  await assert.rejects(f.catalog.deactivateReason(r.id, r.revision), /fijo/);
  await assert.rejects(
    f.catalog.saveReason({ id: null, name: "otro", expected: null }),
    /histórico/,
  );
});
test("Failed reason deactivation leaves it active; same-key retry succeeds", async () => {
  const f = setup();
  await f.ready();
  const r = f.catalog.snapshot().doc.reasons[0]!;
  f.storage.failWrite = true;
  await assert.rejects(f.catalog.deactivateReason(r.id, 1, "retry"));
  assert.ok(f.catalog.reasonNames().includes(r.name));
  f.storage.failWrite = false;
  await f.catalog.deactivateReason(r.id, 1, "retry");
  assert.equal(f.catalog.reasonNames().includes(r.name), false);
});
test("Corrupt scope, missing fixed rows, redirects and receipts fail closed without overwrite", async () => {
  for (const patch of [
    { organizationId: "demo-org-other" },
    { sequence: -1 },
    { reasons: [] },
    { receipts: [{ key: "x" }] },
  ]) {
    const f = setup();
    await f.ready();
    const raw = JSON.stringify({ ...f.catalog.snapshot().doc, ...patch });
    f.data.set(f.catalog.key, raw);
    const g = setup(f.data);
    await g.ready();
    assert.equal(g.catalog.snapshot().ready, false);
    assert.equal(f.data.get(f.catalog.key), raw);
    await assert.rejects(save(g), /Recupera/);
  }
});
test("Read failure does not silently overwrite prior catalog and can recover", async () => {
  const f = setup();
  await f.ready();
  await save(f);
  f.storage.failRead = true;
  const g = setup(f.data, "owner", "demo-org-cristal", f.storage);
  await g.ready();
  assert.equal(g.catalog.snapshot().ready, false);
  f.storage.failRead = false;
  await g.ready();
  assert.ok(g.catalog.tag("Nueva"));
});
test("Closed color palette yields readable capsule text in both approved themes", () => {
  for (const theme of [light, dark])
    for (const color of tagPalette) {
      const tone = tagColors(color, theme === dark, theme.surface);
      assert.ok(tagContrast(tone.foreground, tone.background) >= 4.5);
    }
  assert.throws(() => tagColors("tomato", false, light.surface));
});
test("No persistence adapter means a fully local catalog for pure simulations, without dependencies", async () => {
  const c = new CatalogStore({ id: "demo-owner", role: "owner" }),
    r = new DemoConversationRepository(undefined, c);
  const t = c.tag("Promo nov")!;
  await c.removeTag(t.id, 1);
  assert.equal(
    r.get({ id: "demo-owner", role: "owner" }, "demo-conv-1").tags.length,
    0,
  );
});

test("Catalog-backed contacts use distinct keys outside the legacy default organization", async () => {
  const f = setup();
  await f.ready();
  const c = f.dir.get("demo-conv-1");
  await c.hydrate();
  await c.sale(432100, "Alta");
  const g = setup(f.data, "owner", "demo-org-other");
  await g.ready();
  const other = g.dir.get(c.id);
  await other.hydrate();
  assert.notEqual(other.storageKey, c.storageKey);
  assert.notEqual(other.snapshot().data.amountCents, 432100);
  assert.equal(g.dir.workRepo.organizationId, "demo-org-other");
});
test("Deleting the Facebook Ads tag does not rewrite a contact's historical acquisition source", async () => {
  const f = setup();
  await f.ready();
  assert.equal(f.crm.get("demo-conv-6").source, "Facebook Ads");
  const t = f.catalog.tag("Facebook Ads")!;
  await f.catalog.removeTag(t.id, 1);
  assert.equal(f.crm.get("demo-conv-6").source, "Facebook Ads");
});
