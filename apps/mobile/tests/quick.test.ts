import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QuickRepository,
  quickProblem,
  renderQuick,
} from "../src/features/quick/core";
function setup(
  data = new Map<string, string>(),
  role: "owner" | "coordinator" | "advisor" = "owner",
  org = "demo-org-cristal",
  storage?: ReturnType<typeof port>,
) {
  const io = storage ?? port(data);
  return {
    repo: new QuickRepository({ id: `demo-${role}`, role }, org, io),
    io,
    data,
  };
}
function port(data: Map<string, string>) {
  return {
    fail: false,
    get: async (k: string) => data.get(k) ?? null,
    set: async function (k: string, v: string) {
      if (this.fail) throw Error("disk");
      data.set(k, v);
    },
  };
}
const value = {
  id: null,
  shortcut: "demo",
  body: "¡Hola {nombre}!",
  expected: null,
};
test("Quick defaults preserve existing four Chat replies with no write on hydration", async () => {
  const f = setup();
  await f.repo.hydrate();
  assert.equal(f.repo.snapshot().doc.rows.length, 4);
  assert.equal(f.data.size, 0);
  assert.equal(f.repo.snapshot().doc.rows[0]!.shortcut, "hola");
});
test("Unique new shortcut persists and resolves all name variables without sending a message", async () => {
  const f = setup();
  await f.repo.hydrate();
  const id = await f.repo.save(value);
  const g = setup(f.data);
  await g.repo.hydrate();
  assert.equal(g.repo.snapshot().doc.rows.at(-1)!.id, id);
  assert.equal(
    renderQuick("Hola {nombre}, gracias {nombre}", "Karla Méndez"),
    "Hola Karla, gracias Karla",
  );
});
test("Shortcut contract rejects uppercase, spaces, path characters and >30; text variables strict", () => {
  for (const s of ["Hola", "hola mundo", "a/b", "", "a".repeat(31)])
    assert.ok(quickProblem(s, "Texto"));
  for (const b of [
    "",
    "x".repeat(5000),
    "Hola {email}",
    "{nombre}}",
    "{{nombre}",
  ])
    assert.ok(quickProblem("hola", b));
  assert.equal(quickProblem("a-z_1", "Hola {nombre}"), "");
});
test("Duplicate shortcut rejects without creating a second row", async () => {
  const f = setup();
  await f.repo.hydrate();
  await assert.rejects(
    f.repo.save({ ...value, shortcut: "hola" }),
    /ya existe/,
  );
  assert.equal(f.repo.snapshot().doc.rows.length, 4);
});
test("Edit retains identity and increments revision; previous snapshot stays immutable", async () => {
  const f = setup();
  await f.repo.hydrate();
  const row = f.repo.snapshot().doc.rows[0]!;
  await f.repo.save({
    ...row,
    expected: row.revision,
    body: "Hola {nombre}, texto nuevo",
  });
  assert.equal(f.repo.snapshot().doc.rows[0]!.id, row.id);
  assert.equal(f.repo.snapshot().doc.rows[0]!.revision, 2);
  assert.notEqual(f.repo.snapshot().doc.rows[0]!.body, row.body);
});
test("Stale edit after a second editor save rejects and retains new revision", async () => {
  const f = setup(),
    g = setup(f.data, "coordinator", "demo-org-cristal", f.io);
  await Promise.all([f.repo.hydrate(), g.repo.hydrate()]);
  const row = f.repo.snapshot().doc.rows[0]!;
  await f.repo.save({ ...row, expected: 1, body: "Primera" });
  await assert.rejects(
    g.repo.save({ ...row, expected: 1, body: "Atrasada" }),
    /cambió/,
  );
  await g.repo.reload();
  assert.equal(g.repo.snapshot().doc.rows[0]!.body, "Primera");
});
test("Concurrent different instances sharing storage serialize organization uniqueness", async () => {
  const f = setup(),
    g = setup(f.data, "coordinator", "demo-org-cristal", f.io);
  await Promise.all([f.repo.hydrate(), g.repo.hydrate()]);
  const results = await Promise.allSettled([
    f.repo.save(value),
    g.repo.save(value),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await g.repo.reload();
  assert.equal(
    g.repo.snapshot().doc.rows.filter((r) => r.shortcut === "demo").length,
    1,
  );
});
test("Concurrent distinct creations merge rather than replacing another actor's rows", async () => {
  const f = setup(),
    g = setup(f.data, "coordinator", "demo-org-cristal", f.io);
  await Promise.all([f.repo.hydrate(), g.repo.hydrate()]);
  await Promise.all([
    f.repo.save(value),
    g.repo.save({ ...value, shortcut: "otro" }),
  ]);
  await f.repo.reload();
  assert.equal(f.repo.snapshot().doc.rows.length, 6);
});
test("Advisor reads org catalog but cannot manage it; coordinator can edit", async () => {
  const f = setup();
  await f.repo.hydrate();
  await f.repo.save(value);
  const g = setup(f.data, "advisor");
  await g.repo.hydrate();
  assert.equal(g.repo.snapshot().doc.rows.length, 5);
  await assert.rejects(g.repo.save({ ...value, shortcut: "other" }), /perfil/);
  const c = setup(f.data, "coordinator");
  await c.repo.hydrate();
  await c.repo.save({ ...value, shortcut: "coord" });
  assert.equal(c.repo.snapshot().doc.rows.length, 6);
});
test("Other organization gets independent default catalog and cannot hydrate forged scope", async () => {
  const f = setup();
  await f.repo.hydrate();
  await f.repo.save(value);
  const g = setup(f.data, "owner", "demo-org-other");
  await g.repo.hydrate();
  assert.equal(g.repo.snapshot().doc.rows.length, 4);
  f.data.set(g.repo.key, f.data.get(f.repo.key)!);
  await g.repo.reload();
  assert.equal(g.repo.snapshot().ready, false);
});
test("Failed save keeps previous catalog; retry of same new shortcut succeeds once", async () => {
  const f = setup();
  await f.repo.hydrate();
  f.io.fail = true;
  await assert.rejects(f.repo.save(value));
  assert.equal(f.repo.snapshot().doc.rows.length, 4);
  f.io.fail = false;
  await f.repo.save(value);
  assert.equal(f.repo.snapshot().doc.rows.length, 5);
});
test("Queued inputs are copied before caller mutation", async () => {
  const f = setup();
  await f.repo.hydrate();
  const input = { ...value };
  const job = f.repo.save(input);
  input.body = "Mutado";
  input.shortcut = "mutado";
  await job;
  assert.equal(f.repo.snapshot().doc.rows.at(-1)!.body, value.body);
});
test("Corrupt catalog fails closed without replacing bytes", async () => {
  for (const patch of [
    { schema: 2 },
    { rows: [{ id: "bad" }] },
    { sequence: -1 },
    {
      rows: [
        { id: "demo-quick-local-7", shortcut: "d", body: "A", revision: 1 },
      ],
    },
  ]) {
    const f = setup();
    await f.repo.hydrate();
    const raw = JSON.stringify({ ...f.repo.snapshot().doc, ...patch });
    f.data.set(f.repo.key, raw);
    await f.repo.reload();
    assert.equal(f.repo.snapshot().ready, false);
    assert.equal(f.data.get(f.repo.key), raw);
  }
});
test("Read failure can retry without falling back to a contradictory default catalog", async () => {
  const f = setup();
  await f.repo.hydrate();
  await f.repo.save(value);
  let fail = true;
  const g = setup(f.data, "owner", "demo-org-cristal", {
    ...f.io,
    get: async (k: string) => {
      if (fail) throw Error();
      return f.data.get(k) ?? null;
    },
  });
  await g.repo.hydrate();
  assert.equal(g.repo.snapshot().ready, false);
  fail = false;
  await g.repo.hydrate();
  assert.equal(g.repo.snapshot().doc.rows.length, 5);
});

test("Contact names with replacement metacharacters are inserted literally", () => {
  assert.equal(renderQuick("Hola {nombre}", "$& Demo"), "Hola $&");
});
