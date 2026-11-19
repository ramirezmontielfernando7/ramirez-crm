import assert from "node:assert/strict";
import { test } from "node:test";
import { CrmModel } from "../src/features/crm/core";
import {
  seedConversations,
  DemoConversationRepository,
} from "../src/features/inbox/model";
const setup = (role: "owner" | "advisor" = "owner") =>
  new CrmModel(
    { id: role === "owner" ? "demo-owner" : "demo-advisor", role },
    new DemoConversationRepository(seedConversations(5000)),
  );
test("CRM searches 5000 fictitious contacts and preserves filters selection offset across details", () => {
  const m = setup();
  m.patch({ query: "Karla", offset: 432 });
  const c = m.list()[0]!;
  m.toggle(c.id);
  m.navigate("CRM-11", c.id);
  m.navigate("CRM-10");
  assert.equal(m.state.query, "Karla");
  assert.equal(m.state.offset, 432);
  assert.ok(m.state.selected.has(c.id));
  assert.equal(m.list().length, 1);
});
test("advisor cannot read or mutate foreign contacts, export, stage configuration or consent", () => {
  const m = setup("advisor");
  assert.ok(m.list().every((c) => c.assigned === "demo-advisor"));
  for (const fn of [
    () => m.get("demo-conv-1"),
    () => m.addStage("Prueba"),
    () => m.exportSample(),
    () => m.consent(m.list()[0]!.id, "Opt-in"),
  ])
    assert.throws(fn);
});
test("contact form validates duplicates and cannot fake consent", () => {
  const m = setup();
  assert.throws(() =>
    m.saveContact({ name: "Demo", phone: "5512", email: "", notes: "" }),
  );
  assert.throws(() =>
    m.saveContact({
      name: "Demo",
      phone: "+525555509998",
      email: "incorrecto",
      notes: "",
    }),
  );
  const id = m.saveContact({
    name: "Muestra",
    phone: "+525555509998",
    email: "muestra@example.invalid",
    notes: "Demo",
  });
  assert.equal(m.get(id).consent, "Sin respuesta");
  m.saveContact({
    id,
    name: "Editado",
    phone: "+525555509998",
    email: "",
    notes: "",
  });
  assert.equal(m.get(id).name, "Editado");
});
test("pipeline amount validation and required loss reason update canonical conversation", () => {
  const m = setup(),
    id = m.list()[0]!.id;
  assert.throws(() => m.amount(id, "-1"));
  m.amount(id, "250.50");
  assert.equal(m.get(id).amount, 250.5);
  assert.throws(() => m.move(id, "Perdido"));
  m.move(id, "Perdido", "Precio");
  assert.equal(m.repository.get(m.actor, id).stage, "Perdido");
});
test("stage deletion migrates every contact and preserves at least one stage", () => {
  const m = setup();
  m.addStage("Cotizado");
  const id = m.list()[0]!.id;
  m.move(id, "Cotizado");
  m.color("Cotizado", "#8b5cf6");
  m.deleteStage("Cotizado", "Nuevo");
  assert.equal(m.get(id).stage, "Nuevo");
  assert.ok(!m.stageList.some((s) => s.name === "Cotizado"));
  assert.throws(() => m.deleteStage("Nuevo", "Nuevo"));
});
test("bulk selection actions affect only selected records and export neutralizes CSV formulas", () => {
  const m = setup();
  const id = m.list()[0]!.id;
  m.toggle(id);
  m.bulk("tag", "VIP");
  m.bulk("assign", "demo-advisor");
  assert.ok(m.get(id).tags.includes("VIP"));
  assert.equal(m.get(id).assigned, "demo-advisor");
  const csv = m.exportSample();
  assert.equal(csv.split("\n").length, 2);
  assert.ok(csv.includes("\"'+52"));
});
test("import never reads a device file and requires an explicit consent decision", () => {
  const m = setup();
  assert.throws(() => m.importSample(null));
  const id = m.importSample("unknown");
  assert.equal(m.get(id).consent, "Sin respuesta");
  assert.equal(m.importSample("yes"), id);
  assert.equal(m.get(id).consent, "Opt-in");
});
test("CRM priority and assignment are permission checked, import cannot lift a prior opt-out", () => {
  const m = setup();
  const id = m.importSample("yes");
  m.consent(id, "Baja");
  m.importSample("yes");
  assert.equal(m.get(id).consent, "Baja");
  m.setPriority(id, "Alta");
  assert.equal(m.get(id).priority, "Alta");
  assert.throws(() => m.setPriority(id, "Invalid"));
  m.assignContact(id, "demo-advisor");
  assert.equal(m.get(id).assigned, "demo-advisor");
  const a = setup("advisor");
  assert.throws(() => a.assignContact(a.list()[0]!.id, "demo-owner"));
});

test("a CRM custom stage does not break existing T-M4 task persistence in the same catalog", async () => {
  const { ContactDirectory } = await import("../src/features/contact/core");
  const m = setup(),
    saved = new Map<string, string>();
  m.addStage("Cotizado");
  const id = m.list()[0]!.id;
  m.move(id, "Cotizado");
  const storage = {
    remove: async (k: string) => {
      saved.delete(k);
    },
    get: async (k: string) => saved.get(k) ?? null,
    set: async (k: string, v: string) => {
      saved.set(k, v);
    },
  };
  const d = new ContactDirectory(m.actor, m.repository, storage, () => {}),
    store = d.get(id);
  await store.hydrate();
  await store.task("Revisar cotización", Date.now() + 3600000, m.actor.id);
  assert.equal(store.snapshot().error, "");
  assert.equal(store.snapshot().data.tasks.length, 1);
  const reload = new ContactDirectory(
    m.actor,
    m.repository,
    storage,
    () => {},
  ).get(id);
  await reload.hydrate();
  assert.equal(reload.snapshot().ready, true);
  assert.equal(reload.snapshot().data.stage, "Cotizado");
  assert.throws(() => m.bulk("tag", "Etiqueta desconocida"));
});
