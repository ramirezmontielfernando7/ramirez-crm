import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ContactDirectory,
  decodeDetails,
  systemImportTag,
} from "../src/features/contact/core";
import {
  canChangeMode,
  defaultFlags,
  modeProblem,
  parseAmount,
  parseDue,
} from "../src/features/contact/model";
import {
  DemoConversationRepository,
  type Actor,
} from "../src/features/inbox/model";
const owner: Actor = { id: "demo-owner", role: "owner" };
const advisor: Actor = { id: "demo-advisor", role: "advisor" };
const coordinator: Actor = { id: "demo-coordinator", role: "coordinator" };
function memory() {
  const data = new Map<string, string>();
  let fail = false;
  return {
    data,
    setFail(v: boolean) {
      fail = v;
    },
    async get(k: string) {
      if (fail) throw Error("storage unavailable");
      return data.get(k) ?? null;
    },
    async set(k: string, v: string) {
      if (fail) throw Error("storage unavailable");
      data.set(k, v);
    },
    async remove(k: string) {
      data.delete(k);
    },
  };
}
function fixture(
  actor = owner,
  id = actor.role === "advisor" ? "demo-conv-3" : "demo-conv-1",
  storage = memory(),
) {
  const repo = new DemoConversationRepository();
  let changes = 0;
  const dir = new ContactDirectory(
    actor,
    repo,
    storage,
    () => changes++,
    () => 2_000_000_000_000,
  );
  const store = dir.get(id);
  return { repo, dir, store, storage, changes: () => changes };
}
test("details authorize every read and mutation, including revoked advisor scope", async () => {
  const f = fixture(advisor);
  await f.store.hydrate();
  assert.throws(() => f.dir.get("demo-conv-1"));
  await assert.rejects(f.store.assign("demo-owner"), /perfil/);
  await f.store.stage("Cliente");
  f.repo.updateContact(owner, f.store.id, { assigned: "demo-owner" });
  assert.throws(() => f.store.ai("on"));
  assert.throws(() => f.store.setNoteDraft("secret"));
});
test("lost stage needs reason, persists atomically and leaving it clears the loss", async () => {
  const f = fixture();
  await f.store.hydrate();
  const original = f.repo.get(owner, f.store.id);
  await assert.rejects(f.store.stage("Perdido"), /motivo/);
  assert.equal(f.repo.get(owner, f.store.id), original);
  await f.store.stage("Perdido", "Precio", "Detalle ficticio");
  assert.equal(f.store.snapshot().data.lossReason, "Precio");
  assert.equal(f.repo.get(owner, f.store.id).stage, "Perdido");
  await f.store.stage("Cliente");
  assert.equal(f.store.snapshot().data.lossReason, "");
  await assert.rejects(f.store.stage("Inventada"), /etapa/);
});
test("assignment includes unassigned and active team only; unrelated rows keep identity", async () => {
  const f = fixture(coordinator);
  await f.store.hydrate();
  const other = f.repo.get(coordinator, "demo-conv-2");
  await f.store.assign(null);
  assert.equal(f.repo.get(coordinator, f.store.id).assigned, null);
  await f.store.assign("demo-advisor");
  await assert.rejects(f.store.assign("inactive-sofia"), /activa/);
  assert.equal(f.repo.get(coordinator, "demo-conv-2"), other);
  assert.equal(f.changes(), 2);
});
test("tags validate catalog, preserve import tags and update inbox search", async () => {
  const f = fixture(advisor);
  await f.store.hydrate();
  assert.ok(f.repo.get(advisor, f.store.id).tags.includes(systemImportTag));
  await assert.rejects(f.store.tags(["VIP"]), /sistema/);
  await f.store.tags([systemImportTag, "VIP"]);
  assert.match(f.repo.get(advisor, f.store.id).search, /vip/);
  await assert.rejects(f.store.tags([systemImportTag, "invalid"]), /válidas/);
});
test("AI states and take conversation update assignment and pause together", async () => {
  const f = fixture();
  await f.store.hydrate();
  await f.store.ai("off");
  assert.equal(f.repo.get(owner, f.store.id).ai, "off");
  await f.store.assign("demo-coordinator");
  await f.store.ai("on");
  await f.store.take();
  const c = f.repo.get(owner, f.store.id);
  assert.equal(c.ai, "pause");
  assert.equal(c.assigned, owner.id);
  assert.equal(f.store.snapshot().data.events[0]!.kind, "Asignación");
});
test("connection policy gates addon, delegation, groups, device and emergency; Meta stays available inside authorized UI", () => {
  const f = fixture();
  const c = f.repo.get(owner, f.store.id);
  const flags = { ...defaultFlags(owner), addon: true };
  assert.equal(canChangeMode(owner, c, flags), true);
  assert.equal(canChangeMode(owner, c, { ...flags, addon: false }), false);
  assert.equal(canChangeMode(advisor, c, flags), false);
  assert.equal(canChangeMode(advisor, c, { ...flags, modeGrant: true }), true);
  assert.equal(
    canChangeMode(coordinator, c, {
      ...defaultFlags(coordinator),
      addon: true,
    }),
    true,
  );
  assert.equal(canChangeMode(owner, { ...c, group: true }, flags), false);
  assert.match(modeProblem(owner, c, flags, "direct"), /vinculado/);
  assert.match(
    modeProblem(
      owner,
      c,
      { ...flags, linked: true, emergency: true },
      "hybrid",
    ),
    /emergencia/,
  );
  assert.equal(
    modeProblem(owner, c, { ...flags, emergency: true }, "meta"),
    "",
  );
});
test("connection selection changes only after success; save failure and permission revocation are safe", async () => {
  const f = fixture();
  await f.store.hydrate();
  await assert.rejects(f.store.mode("direct"), /perfil/);
  f.dir.setFlags({ addon: true });
  await assert.rejects(f.store.mode("direct"), /vinculado/);
  assert.equal(f.store.snapshot().data.mode, "meta");
  f.dir.setFlags({ linked: true });
  f.store.failNext = true;
  await assert.rejects(f.store.mode("hybrid", "same-mode"), /Reintenta/);
  assert.equal(f.store.snapshot().data.mode, "meta");
  await f.store.mode("hybrid", "same-mode");
  assert.equal(f.store.snapshot().data.mode, "hybrid");
  f.dir.setFlags({ emergency: true });
  await assert.rejects(f.store.mode("direct"), /emergencia/);
  await f.store.mode("meta");
  f.dir.setFlags({ addon: false });
  await assert.rejects(f.store.mode("hybrid"), /perfil/);
});
test("internal notes do not touch message previews, deduplicate and persist per profile/contact", async () => {
  const f = fixture();
  await f.store.hydrate();
  const c = f.repo.get(owner, f.store.id);
  f.store.setNoteDraft("Nota solo del equipo");
  await Promise.all([
    f.store.note("Nota solo del equipo", "note-once"),
    f.store.note("Nota solo del equipo", "note-once"),
  ]);
  assert.equal(
    f.store
      .snapshot()
      .data.events.filter((e) => e.text === "Nota solo del equipo").length,
    1,
  );
  assert.equal(f.store.snapshot().noteDraft, "");
  assert.equal(f.repo.get(owner, f.store.id), c);
  const restored = new ContactDirectory(owner, f.repo, f.storage, () => {}).get(
    f.store.id,
  );
  await restored.hydrate();
  assert.equal(
    restored.snapshot().data.events[0]!.text,
    "Nota solo del equipo",
  );
  const other = new ContactDirectory(
    coordinator,
    f.repo,
    f.storage,
    () => {},
  ).get(f.store.id);
  await other.hydrate();
  assert.ok(
    other
      .snapshot()
      .data.events.every((e) => e.text !== "Nota solo del equipo"),
  );
});
test("saving a note cannot erase text typed while storage is pending; flags cannot change mid-commit", async () => {
  const f = fixture();
  await f.store.hydrate();
  let release = () => {};
  let entered = () => {};
  const pending = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const original = f.storage.set;
  f.storage.set = async (k, v) => {
    entered();
    await pending;
    await original(k, v);
  };
  f.store.setNoteDraft("Primera nota");
  const save = f.store.note("Primera nota");
  await started;
  f.store.setNoteDraft("Otra nota");
  assert.throws(() => f.dir.setFlags({ addon: true }), /termine/);
  release();
  await save;
  assert.equal(f.store.snapshot().noteDraft, "Otra nota");
});
test("failures and offline keep state and draft, then retry exactly once", async () => {
  const f = fixture();
  await f.store.hydrate();
  const old = f.store.snapshot().data;
  f.store.setNoteDraft("Conservar nota");
  f.storage.setFail(true);
  await assert.rejects(f.store.note("Conservar nota", "retry"), /storage/);
  assert.equal(f.store.snapshot().data, old);
  assert.equal(f.store.snapshot().noteDraft, "Conservar nota");
  f.storage.setFail(false);
  f.store.view("offline");
  await assert.rejects(f.store.note("Conservar nota", "retry"), /Sin conexión/);
  f.store.view("normal");
  await f.store.note("Conservar nota", "retry");
  assert.equal(
    f.store.snapshot().data.events.filter((e) => e.text === "Conservar nota")
      .length,
    1,
  );
});
test("request keys reject conflicting payloads; queued changes use latest state", async () => {
  const f = fixture();
  await f.store.hydrate();
  const a = f.store.stage("Cliente", "", "", "unique");
  assert.throws(() => f.store.stage("Nuevo", "", "", "unique"), /otro cambio/);
  await Promise.all([a, f.store.tags(["VIP"]), f.store.ai("off")]);
  assert.equal(f.store.snapshot().data.stage, "Cliente");
  assert.deepEqual(f.store.snapshot().data.tags, ["VIP"]);
  assert.equal(f.store.snapshot().data.ai, "off");
});
test("concurrent inbox change is detected instead of overwritten", async () => {
  const f = fixture();
  await f.store.hydrate();
  const original = f.storage.set;
  f.storage.set = async (k, v) => {
    await original(k, v);
    if (JSON.parse(v).stage === "Cliente")
      f.repo.updateContact(owner, f.store.id, { stage: "Nuevo" });
  };
  await assert.rejects(f.store.stage("Cliente"), /cambió/);
  assert.equal(f.repo.get(owner, f.store.id).stage, "Nuevo");
  assert.notEqual(
    decodeDetails(f.storage.data.get(f.store.storageKey)!).stage,
    "Cliente",
  );
});
test("tasks validate title, calendar, active assignee and advisor own scope; safe retry creates one", async () => {
  const f = fixture(advisor);
  await f.store.hydrate();
  const due = parseDue("12/11/2026", "17:00");
  await assert.rejects(f.store.task("", due, advisor.id), /Escribe/);
  await assert.rejects(f.store.task("Llamar", NaN, advisor.id), /fecha/);
  await assert.rejects(f.store.task("Llamar", due, owner.id), /propias/);
  await Promise.all([
    f.store.task("Cotización demo", due, advisor.id, "task-once"),
    f.store.task("Cotización demo", due, advisor.id, "task-once"),
  ]);
  assert.equal(f.store.snapshot().data.tasks.length, 1);
  const id = f.store.snapshot().data.tasks[0]!.id;
  await f.store.toggleTask(id);
  assert.equal(f.store.snapshot().data.tasks[0]!.done, true);
  await f.store.toggleTask(id);
  assert.equal(f.store.snapshot().data.tasks[0]!.done, false);
});
test("amount and date parsing reject impossible values, handle decimals and leap years", () => {
  assert.equal(parseAmount("$4,800.25"), 480025);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("0.01"), 1);
  for (const value of ["-10", "1.234", "1e4", "100000000"])
    assert.throws(() => parseAmount(value));
  assert.ok(Number.isFinite(parseDue("29/02/2028", "17:00")));
  for (const [d, t] of [
    ["31/02/2026", "17:00"],
    ["12/11/2026", "24:00"],
    ["12/11/2026", "17:70"],
    ["12/11/1999", "17:00"],
  ])
    assert.throws(() => parseDue(d!, t!));
});
test("group sale metadata is unavailable and invalid cents cannot persist", async () => {
  const f = fixture();
  await f.store.hydrate();
  await f.store.sale(12345, "Alta");
  assert.equal(f.store.snapshot().data.amountCents, 12345);
  await assert.rejects(f.store.sale(-1, "Alta"), /válido/);
  const group = f.dir.get("demo-conv-13");
  await group.hydrate();
  await assert.rejects(group.sale(100, "Alta"), /grupo/);
});
test("corrupt local data fails closed without replacing it and storage recovery is possible", async () => {
  const f = fixture();
  f.storage.data.set(f.store.storageKey, '{"version":999}');
  await f.store.hydrate();
  assert.equal(f.store.snapshot().ready, false);
  assert.match(f.store.snapshot().error, /válidos/);
  await assert.rejects(f.store.stage("Cliente"), /carguen/);
  assert.equal(f.storage.data.get(f.store.storageKey), '{"version":999}');
  f.storage.data.delete(f.store.storageKey);
  await f.store.hydrate();
  assert.equal(f.store.snapshot().ready, true);
  const data = f.store.snapshot().data;
  assert.throws(
    () =>
      decodeDetails(
        JSON.stringify({ ...data, events: [data.events[0], data.events[0]] }),
      ),
    /duplicados/,
  );
});
test("history is capped, newest first with unique IDs and stable prior object references", async () => {
  const f = fixture();
  await f.store.hydrate();
  const prior = f.store.snapshot().data.events[0];
  await f.store.note("Nueva");
  assert.equal(f.store.snapshot().data.events[1], prior);
  for (let i = 0; i < 255; i++) await f.store.note(`Nota ${i}`);
  const events = f.store.snapshot().data.events;
  assert.equal(events.length, 250);
  assert.equal(events[0]!.text, "Nota 254");
  assert.equal(new Set(events.map((e) => e.id)).size, 250);
});
test("bounded details cache restores persisted changes after eviction and protects unsaved notes", async () => {
  const f = fixture();
  await f.store.hydrate();
  await f.store.sale(10000, "Alta");
  f.store.setNoteDraft("No perder al cambiar de pantalla");
  for (let i = 2; i <= 67; i++) await f.dir.get(`demo-conv-${i}`).hydrate();
  assert.equal(f.dir.get(f.store.id), f.store);
  assert.equal(
    f.store.snapshot().noteDraft,
    "No perder al cambiar de pantalla",
  );
  f.store.setNoteDraft("");
  for (let i = 68; i <= 132; i++) await f.dir.get(`demo-conv-${i}`).hydrate();
  const restored = f.dir.get(f.store.id);
  assert.notEqual(restored, f.store);
  await restored.hydrate();
  assert.equal(restored.snapshot().data.amountCents, 10000);
});
test("cached details reconcile T-M2 assignment/stage changes without extra notifications", async () => {
  const f = fixture();
  await f.store.hydrate();
  let notifications = 0;
  f.store.subscribe(() => notifications++);
  f.dir.reconcile();
  assert.equal(notifications, 0);
  f.repo.assign(owner, [f.store.id], "demo-coordinator");
  f.repo.updateContact(owner, f.store.id, { stage: "Cliente" });
  f.dir.reconcile();
  assert.equal(f.store.snapshot().data.stage, "Cliente");
  assert.equal(f.store.snapshot().data.assigned, "demo-coordinator");
  assert.equal(notifications, 1);
  f.dir.reconcile();
  assert.equal(notifications, 1);
  await f.store.note("Datos actuales");
  assert.equal(f.store.snapshot().data.stage, "Cliente");
});
