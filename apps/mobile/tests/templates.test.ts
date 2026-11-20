import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamRepository } from "../src/features/team/core";
import {
  TemplateStore,
  type TemplateInput,
} from "../src/features/templates/core";
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
    store = new TemplateStore(team, actor, io);
  return { io, data, team, store };
}
const input: TemplateInput = {
  name: "seguimiento_prueba",
  category: "UTILITY",
  header: "text",
  headerText: "Consulta ficticia",
  body: "Hola {{1}}, tu consulta ficticia está lista.",
  footer: "Responde BAJA para no recibir mensajes",
  button: "quick",
  buttonText: "Confirmar",
};
test("Template catalog preserves existing chat IDs and blocks unapproved templates", async () => {
  const f = fixture();
  await f.store.hydrate();
  assert.ok(
    f.store
      .render("recordatorio_cita", ["Ana", "martes", "10:00"])
      .includes("martes"),
  );
  assert.throws(() => f.store.render("te_extrañamos", ["Ana"]), /aprobada/);
  assert.equal(f.store.rows().length, 4);
});
test("New template enters review, uses stable receipt and restores", async () => {
  const f = fixture();
  await f.store.hydrate();
  const id = await f.store.submit(input, "one");
  assert.equal(await f.store.submit(input, "one"), id);
  await assert.rejects(f.store.submit({ ...input, body: "Otro" }, "one"));
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  assert.equal(g.store.get(id).status, "pending");
  assert.throws(() => g.store.render(id, ["Ana"]));
  assert.equal(g.store.rows().length, 5);
});
test("Template name, variables, headers and buttons validate strictly", async () => {
  const f = fixture();
  await f.store.hydrate();
  for (const patch of [
    { name: "BAD NAME" },
    { body: "Hola {{2}}" },
    { body: "Hola {{0}}" },
    { body: "Hola {{1}" },
    { body: "Hola {{1}} {{2}} {{3}} {{4}}" },
    { headerText: "{{1}}" },
    { buttonText: "" },
    { body: "" },
  ])
    await assert.rejects(
      f.store.submit(
        { ...input, ...patch } as TemplateInput,
        JSON.stringify(patch),
      ),
    );
  const id = await f.store.submit(input, "good");
  await assert.rejects(f.store.submit(input, "duplicate"));
  await f.store.review(id, "approved", "", 1);
  assert.throws(() => f.store.render(id, [""]));
  assert.throws(() => f.store.render(id, ["{{bad}}"]));
  assert.ok(f.store.render(id, ["Ana"]).includes("Confirmar"));
});
test("Simulated rejection correction retains identity, uses revision and requires fresh approval", async () => {
  const f = fixture();
  await f.store.hydrate();
  const old = f.store.get("cotizacion_lista");
  await f.store.submit({ ...input, name: old.name }, "correct", {
    id: old.id,
    revision: old.revision,
  });
  assert.equal(f.store.get(old.id).status, "pending");
  await assert.rejects(
    f.store.submit(input, "stale", { id: old.id, revision: old.revision }),
  );
  await f.store.review(old.id, "approved", "", 2);
  assert.equal(f.store.get(old.id).status, "approved");
});
test("Pausing a template propagates to peers, invalidates approval and preserves old snapshots", async () => {
  const f = fixture();
  await f.store.hydrate();
  const other = new TemplateStore(f.team, "demo-coordinator", f.io);
  await other.hydrate();
  const release = other.retain(),
    previous = other.get("promo_2x1");
  await f.store.review("promo_2x1", "paused", "", 1);
  assert.throws(() => other.render("promo_2x1", ["Ana"]));
  assert.equal(previous.status, "approved");
  await f.store.review("promo_2x1", "approved", "", 2);
  assert.throws(() => other.assertApproved("promo_2x1", 1), /cambió/);
  release();
});
test("Advisor can render approved templates but cannot create or simulate review", async () => {
  const f = fixture("demo-advisor");
  await f.store.hydrate();
  assert.ok(f.store.render("promo_2x1", ["Ana"]));
  await assert.rejects(f.store.submit(input, "one"));
  await assert.rejects(f.store.review("promo_2x1", "paused", "", 1));
});
test("Other organization cannot restore catalog or inherit pending templates", async () => {
  const f = fixture();
  await f.store.hydrate();
  await f.store.submit(input, "one");
  const g = fixture("demo-owner", "demo-org-other", f.data);
  await g.store.hydrate();
  assert.equal(g.store.rows().length, 4);
  f.data.set(g.store.key, f.data.get(f.store.key)!);
  const bad = fixture("demo-owner", "demo-org-other", f.data);
  await bad.store.hydrate();
  assert.equal(bad.store.snapshot().ready, false);
});
test("Concurrent names are unique and failed writes keep the prior state", async () => {
  const f = fixture();
  await f.store.hydrate();
  const c = new TemplateStore(f.team, "demo-coordinator", f.io);
  await c.hydrate();
  const results = await Promise.allSettled([
    f.store.submit(input, "owner"),
    c.submit(input, "coordinator"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const set = f.io.set;
  f.io.set = async () => {
    throw Error("disk");
  };
  await assert.rejects(f.store.submit({ ...input, name: "segundo" }, "second"));
  assert.equal(f.store.snapshot().doc.rows.length, 5);
  f.io.set = set;
  await f.store.submit({ ...input, name: "segundo" }, "second");
  assert.equal(f.store.snapshot().doc.rows.length, 6);
});
test("Chat uses the same catalog for sending and rejects a failed message retry after pause", async () => {
  const f = fixture();
  await f.store.hydrate();
  const { ChatStore, DraftRepository } =
    await import("../src/features/chat/core");
  const { DemoConversationRepository } =
    await import("../src/features/inbox/model");
  const { DemoHistoryRepository, DemoTransport } =
    await import("../src/features/chat/model");
  const actor = { id: "demo-owner", role: "owner" } as const,
    repo = new DemoConversationRepository(),
    transport = new DemoTransport(),
    chat = new ChatStore(
      actor,
      "demo-conv-1",
      repo,
      new DemoHistoryRepository(repo),
      transport,
      new DraftRepository(f.io),
      () => {},
      Date.now,
      f.store,
    );
  await chat.hydrate();
  transport.nextFailure = "before";
  const m = await chat.send({
    templateId: "promo_2x1",
    text: "",
    variables: ["Ana"],
    key: "one",
  });
  assert.equal(m.status, "failed");
  await f.store.review("promo_2x1", "paused", "", 1);
  assert.throws(() => chat.retry(m.id), /aprobada/);
  assert.throws(
    () =>
      chat.send({
        templateId: "promo_2x1",
        text: "",
        variables: ["Ana"],
        key: "two",
      }),
    /aprobada/,
  );
});

test("Late catalog hydration cannot revive a paused template after peer update", async () => {
  const f = fixture();
  await f.store.hydrate();
  await f.store.submit(input, "seed");
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r)),
    io = {
      ...f.io,
      get: async (k: string) => {
        const raw = await f.io.get(k);
        entered();
        await gate;
        return raw;
      },
    };
  const viewer = new TemplateStore(f.team, "demo-coordinator", io),
    cleanup = viewer.retain();
  const load = viewer.hydrate();
  await started;
  await f.store.review("promo_2x1", "paused", "", 1);
  release();
  await load;
  assert.throws(() => viewer.assertApproved("promo_2x1"), /aprobada/);
  cleanup();
});
test("Template pending input is copied and corrupted variables fail restoration without overwriting bytes", async () => {
  const f = fixture();
  await f.store.hydrate();
  const value = { ...input };
  const saving = f.store.submit(value, "copy");
  value.body = "Modified after dispatch";
  const id = await saving;
  assert.equal(f.store.get(id).body, input.body);
  const d = JSON.parse(f.data.get(f.store.key)!);
  d.rows[0].body = "Hola {{999}}";
  const bytes = JSON.stringify(d);
  f.data.set(f.store.key, bytes);
  const g = fixture("demo-owner", "demo-org-cristal", f.data);
  await g.store.hydrate();
  assert.equal(g.store.snapshot().ready, false);
  assert.equal(f.data.get(g.store.key), bytes);
});
