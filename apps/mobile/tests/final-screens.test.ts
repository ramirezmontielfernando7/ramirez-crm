import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamRepository } from "../src/features/team/core";
import {
  PersonalizationStore,
  accents,
  fonts,
  resolveAppearance,
} from "../src/features/personalization/core";
import {
  PlatformStore,
  sampleOrganizations,
} from "../src/features/platform/core";
import { palette, fontFamily } from "../src/theme/personalized";
import { light, dark } from "../src/theme/tokens";
import { settingsFor } from "../src/features/more/catalog";
import { visibleModules } from "../src/domain/access";
function fixture(org = "demo-org-cristal", data = new Map<string, string>()) {
  const io = {
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => {
      data.set(k, v);
    },
    remove: async (k: string) => {
      data.delete(k);
    },
  };
  const team = new TeamRepository(org, io);
  return {
    team,
    io,
    data,
    store: (actor = "demo-owner") => new PersonalizationStore(team, actor, io),
  };
}
async function ready() {
  const f = fixture();
  await f.team.hydrate();
  const s = f.store();
  await s.hydrate();
  return { ...f, s };
}
test("PLT business owner is denied until explicit fictional metadata capability; no write API exists", async () => {
  const f = await ready(),
    s = new PlatformStore(f.team, "demo-owner");
  await s.hydrate();
  assert.equal(s.snapshot().allowed, false);
  assert.throws(() => s.organization("o2"));
  assert.throws(() => s.demoAccess(true, ""));
  s.demoAccess(true, "SOLO METADATOS FICTICIOS");
  await s.hydrate();
  assert.equal(s.organization("o2").plan, "Pro");
  assert.equal(s.snapshot().organizations.length, 4);
  assert.equal("changePlan" in s, false);
  assert.equal("messages" in s.organization("o2"), false);
});
test("PLT explicit capability belongs to one simulated session, not its role or other instances", async () => {
  const f = await ready(),
    a = new PlatformStore(f.team, "demo-owner"),
    b = new PlatformStore(f.team, "demo-owner");
  a.demoAccess(true, "SOLO METADATOS FICTICIOS");
  await a.hydrate();
  await b.hydrate();
  assert.equal(b.snapshot().allowed, false);
  a.demoAccess(false, "SOLO METADATOS FICTICIOS");
  assert.equal(a.snapshot().organizations.length, 0);
  assert.throws(() => a.organization("o2"));
});
test("PLT late load cannot repopulate metadata after revocation", async () => {
  const f = await ready();
  let finish!: (v: typeof sampleOrganizations) => void;
  const s = new PlatformStore(
    f.team,
    "demo-owner",
    () => new Promise((r) => (finish = r)),
  );
  s.demoAccess(true, "SOLO METADATOS FICTICIOS");
  const p = s.hydrate();
  s.demoAccess(false, "SOLO METADATOS FICTICIOS");
  finish(sampleOrganizations);
  await p;
  assert.deepEqual(s.snapshot().organizations, []);
  assert.equal(s.snapshot().allowed, false);
});
test("PLT loading failure can retry, empty metadata is explicit, unknown ids do not fall back", async () => {
  const f = await ready();
  let failure = true;
  const s = new PlatformStore(f.team, "demo-owner", async () => {
    if (failure) throw Error("test");
    return [];
  });
  s.demoAccess(true, "SOLO METADATOS FICTICIOS");
  await s.hydrate();
  assert.ok(s.snapshot().error);
  failure = false;
  await s.hydrate();
  assert.equal(s.snapshot().ready, true);
  assert.equal(s.snapshot().organizations.length, 0);
  assert.throws(() => s.organization("o99"));
});
test("PLT arbitrary tenant payload is rejected rather than exposed", async () => {
  const f = await ready(),
    s = new PlatformStore(f.team, "demo-owner", async () => [
      { ...sampleOrganizations[0]!, name: "Injected" },
    ]);
  s.demoAccess(true, "SOLO METADATOS FICTICIOS");
  await s.hydrate();
  assert.equal(s.snapshot().ready, false);
  assert.deepEqual(s.snapshot().organizations, []);
});
test("Personalization defaults preserve original B, Inter, classic bubbles and all permitted pillars", async () => {
  const { s } = await ready();
  assert.deepEqual(
    resolveAppearance(s.snapshot().brand, s.snapshot().personal),
    { theme: "light", font: "Inter", chat: "classic" },
  );
  assert.equal(s.snapshot().brand.accent, "#0e7c80");
  assert.deepEqual(s.navigation("owner"), visibleModules("owner"));
  assert.equal(palette("#0e7c80", false), light);
  assert.equal(palette("#0e7c80", true), dark);
});
test("Appearance persists per user and organization; personal preference overrides organization", async () => {
  const { s, store, team, io, data } = await ready();
  await s.brand({
    defaults: { theme: "dark", font: "Geist", chat: "whatsapp" },
  });
  assert.equal(
    resolveAppearance(s.snapshot().brand, s.snapshot().personal).font,
    "Geist",
  );
  await s.personal({ theme: "light", font: "DMSans", chat: "classic" });
  const restored = store();
  await restored.hydrate();
  assert.equal(
    resolveAppearance(restored.snapshot().brand, restored.snapshot().personal)
      .theme,
    "light",
  );
  const advisor = store("demo-advisor");
  await advisor.hydrate();
  assert.equal(
    resolveAppearance(advisor.snapshot().brand, advisor.snapshot().personal)
      .theme,
    "dark",
  );
  const other = fixture("demo-org-other", data);
  await other.team.hydrate();
  const o = other.store();
  await o.hydrate();
  assert.equal(o.snapshot().brand.name, "Dashfort");
  assert.equal(o.snapshot().personal.font, null);
  await s.personal({ theme: null, font: null, chat: null });
  assert.equal(
    resolveAppearance(s.snapshot().brand, s.snapshot().personal).chat,
    "whatsapp",
  );
});
test("Advisors can personalize themselves but cannot write organization brand or navigation", async () => {
  const { store } = await ready(),
    a = store("demo-advisor");
  await a.hydrate();
  await a.personal({ font: "PlusJakarta" });
  assert.equal(a.snapshot().personal.font, "PlusJakarta");
  await assert.rejects(a.brand({ name: "No" }));
  await assert.rejects(a.menu("advisor", ["more"]));
});
test("Coordinator cannot obtain owner-only brand or menu management", async () => {
  const { store } = await ready(),
    c = store("demo-coordinator");
  await c.hydrate();
  await assert.rejects(c.brand({ asset: "sample" }));
  await assert.rejects(c.menu("coordinator", ["more"]));
});
test("Menu permits hiding and ordering but never escalates role; More remains fixed and unique", async () => {
  const { s } = await ready();
  await s.menu("owner", ["crm", "inbox", "more"]);
  assert.deepEqual(s.navigation("owner"), ["crm", "inbox", "more"]);
  assert.deepEqual(s.navigation("owner", ["crm"]), ["inbox", "more"]);
  for (const m of [
    ["studio", "more"],
    ["inbox"],
    ["more", "inbox"],
    ["inbox", "inbox", "more"],
    ["inbox", "crm", "studio", "marketing", "inbox", "more"],
  ])
    await assert.rejects(s.menu("advisor", m as any));
  await s.menu("advisor", ["more"]);
  assert.deepEqual(s.navigation("advisor"), ["more"]);
});
test("Concurrent organization changes merge committed data and broadcast to retained peers", async () => {
  const { s, store } = await ready(),
    b = store();
  await b.hydrate();
  const stop = s.retain(),
    stop2 = b.retain();
  await Promise.all([
    s.brand({ name: "Muestra" }),
    b.brand({ accent: "#2563eb" }),
  ]);
  assert.equal(s.snapshot().brand.name, "Muestra");
  assert.equal(s.snapshot().brand.accent, "#2563eb");
  assert.equal(b.snapshot().brand.revision, 2);
  stop();
  stop2();
});
test("Concurrent personal changes are serialized and reentrant subscribers do not duplicate writes", async () => {
  const { s } = await ready();
  let triggered = false,
    p: Promise<unknown> | undefined;
  const stop = s.subscribe(() => {
    if (s.snapshot().personal.font === "Geist" && !triggered) {
      triggered = true;
      p = s.personal({ chat: "whatsapp" });
    }
  });
  await s.personal({ font: "Geist" });
  await p;
  assert.equal(s.snapshot().personal.revision, 2);
  assert.equal(s.snapshot().personal.chat, "whatsapp");
  stop();
});
test("Unready or failed storage cannot overwrite settings; error is recoverable", async () => {
  const f = await ready();
  let fail = true;
  const io = {
    ...f.io,
    get: async (k: string) => {
      if (fail) throw Error("disk");
      return f.io.get(k);
    },
  };
  const s = new PersonalizationStore(f.team, "demo-owner", io);
  await s.hydrate();
  assert.ok(s.snapshot().error);
  await assert.rejects(s.brand({ name: "No" }));
  fail = false;
  await s.hydrate();
  await s.brand({ name: "Sí" });
  assert.equal(s.snapshot().brand.name, "Sí");
});
test("Failed persistence leaves previous theme and brand unchanged", async () => {
  const f = await ready();
  let fail = false;
  const io = {
    ...f.io,
    set: async (k: string, v: string) => {
      if (fail) throw Error("disk");
      return f.io.set(k, v);
    },
  };
  const s = new PersonalizationStore(f.team, "demo-owner", io);
  await s.hydrate();
  fail = true;
  await assert.rejects(s.personal({ theme: "dark" }));
  await assert.rejects(s.brand({ name: "No" }));
  assert.equal(s.snapshot().personal.theme, null);
  assert.equal(s.snapshot().brand.name, "Dashfort");
});
test("Strict brand and personal scope decoders reject another organization, subject and unknown fields", async () => {
  const f = await ready();
  for (const [key, value] of [
    [f.s.orgKey, { ...f.s.snapshot().brand, org: "demo-other" }],
    [f.s.personalKey, { ...f.s.snapshot().personal, actor: "demo-advisor" }],
    [f.s.personalKey, { ...f.s.snapshot().personal, secret: "not-allowed" }],
  ] as const) {
    f.data.clear();
    f.data.set(key, JSON.stringify(value));
    const s = f.store();
    await s.hydrate();
    assert.equal(s.snapshot().ready, false);
  }
});
test("Brand validates names, assets, fonts, themes, palettes and unknown patch fields", async () => {
  const { s } = await ready();
  for (const p of [
    { name: "" },
    { name: "<script>" },
    { name: "a".repeat(41) },
    { accent: "red" },
    { asset: "https://external.invalid" },
    { secret: "invalid" },
  ])
    await assert.rejects(s.brand(p as any));
  for (const p of [
    { theme: "invalid" },
    { font: "remote" },
    { chat: "invalid" },
    { org: "other" },
  ])
    await assert.rejects(s.personal(p as any));
});
test("All approved fonts resolve to bundled static families in three weights", () => {
  for (const f of fonts)
    for (const w of ["regular", "medium", "semibold"] as const)
      assert.match(fontFamily(f, w), new RegExp(`^${f}_`));
});
function contrast(a: string, b: string) {
  const l = (hex: string) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
  };
  return (Math.max(l(a), l(b)) + 0.05) / (Math.min(l(a), l(b)) + 0.05);
}
test("Brand-derived accent and active text preserve accessible contrast in both themes", () => {
  for (const a of accents)
    for (const d of [false, true]) {
      const p = palette(a, d);
      assert.ok(contrast(p.accent, p.onAccent) >= 4.5, `${a}/${d}: primary`);
      assert.ok(contrast(p.accentInk, p.surface) >= 4.5, `${a}/${d}: text`);
      assert.ok(contrast(p.accentInk, p.wash) >= 4.5, `${a}/${d}: selected`);
    }
});
test("Settings catalog search, accents, role restrictions and all exact section destinations", () => {
  assert.equal(settingsFor("advisor").length, 0);
  assert.equal(settingsFor("owner").flatMap((g) => g.items).length, 17);
  assert.equal(
    settingsFor("coordinator")
      .flatMap((g) => g.items)
      .some((i) => i.owner),
    false,
  );
  assert.equal(
    settingsFor("owner", "navegacion")[0]!.items[0]!.route,
    "/navigation-settings",
  );
  assert.equal(settingsFor("owner", "no-existing-setting").length, 0);
});
test("Deferred brand write rolls back if the owner loses authority during storage IO", async () => {
  const f = await ready();
  let begin!: () => void, finish!: () => void;
  const entered = new Promise<void>((r) => (begin = r)),
    pause = new Promise<void>((r) => (finish = r));
  const second = f.team
    .snapshot()
    .doc.members.find((m) => m.id === "demo-coordinator")!;
  await f.team.update(
    "demo-owner",
    second.id,
    {
      role: "owner",
      active: true,
      receiveNew: true,
      expected: second.revision,
    },
    "promote",
  );
  const io = {
    ...f.io,
    set: async (k: string, v: string) => {
      await f.io.set(k, v);
      if (k === f.s.orgKey) {
        begin();
        await pause;
      }
    },
  };
  const s = new PersonalizationStore(f.team, "demo-owner", io);
  await s.hydrate();
  const job = s.brand({ name: "Unauthorized" });
  const rejected = assert.rejects(job);
  await entered;
  const owner = f.team
    .snapshot()
    .doc.members.find((m) => m.id === "demo-owner")!;
  await f.team.update(
    second.id,
    owner.id,
    {
      role: "advisor",
      active: true,
      receiveNew: true,
      expected: owner.revision,
    },
    "demote",
  );
  finish();
  await rejected;
  assert.equal(f.data.has(s.orgKey), false);
  assert.equal(s.snapshot().brand.name, "Dashfort");
});
test("Platform retained views clear metadata immediately after membership deactivation", async () => {
  const f = await ready(),
    s = new PlatformStore(f.team, "demo-advisor"),
    stop = s.retain();
  s.demoAccess(true, "SOLO METADATOS FICTICIOS");
  await s.hydrate();
  const m = f.team.snapshot().doc.members.find((m) => m.id === "demo-advisor")!;
  await f.team.update(
    "demo-owner",
    m.id,
    { role: m.role, active: false, receiveNew: false, expected: m.revision },
    "deactivate",
  );
  assert.equal(s.snapshot().allowed, false);
  assert.equal(s.snapshot().organizations.length, 0);
  assert.throws(() => s.organization("o2"));
  stop();
});

test("Legacy device theme is preserved without overwriting bytes or crossing into another organization", async () => {
  const f = fixture();
  f.data.set("dashfort.demo.theme", "dark");
  await f.team.hydrate();
  const s = f.store();
  await s.hydrate();
  assert.equal(s.snapshot().personal.theme, "dark");
  assert.equal(f.data.size, 1);
  await s.personal({ theme: "light" });
  const restored = f.store();
  await restored.hydrate();
  assert.equal(restored.snapshot().personal.theme, "light");
  assert.equal(f.data.get("dashfort.demo.theme"), "dark");
  const other = fixture("demo-org-other", f.data);
  await other.team.hydrate();
  const o = other.store();
  await o.hydrate();
  assert.equal(
    resolveAppearance(o.snapshot().brand, o.snapshot().personal).theme,
    "light",
  );
});
