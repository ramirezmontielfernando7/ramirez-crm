import assert from "node:assert/strict";
import { test } from "node:test";
import { TeamRepository } from "../src/features/team/core";
import { guardedStorage } from "../src/features/team/guarded-storage";
import { TeamChatStore } from "../src/features/team-chat/core";
function setup(
  data = new Map<string, string>(),
  actor = "demo-owner",
  org = "demo-org-cristal",
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
    chat = new TeamChatStore(team, actor, io);
  return { data, io, team, chat };
}
test("Internal defaults reuse roster and remain separate from customer messages", async () => {
  const f = setup();
  await f.chat.hydrate();
  assert.equal(f.chat.list().length, 2);
  assert.equal(
    f.chat.messages("demo-room-sales")[0]!.author,
    "demo-coordinator",
  );
  assert.equal(f.data.size, 0);
});
test("Direct conversation reuses canonical pair and survives restore", async () => {
  const f = setup();
  await f.chat.hydrate();
  const a = await f.chat.create(["demo-advisor"], null, "a"),
    b = await f.chat.create(["demo-advisor"], null, "b");
  assert.equal(a, b);
  const g = setup(f.data);
  await g.chat.hydrate();
  assert.equal(g.chat.get(a).members.length, 2);
});
test("Group operations require membership; an owner cannot inspect an unrelated private conversation", async () => {
  const f = setup();
  await f.chat.hydrate();
  const id = await f.chat.create(["demo-coordinator"], "Privado", "group");
  const other = setup(f.data, "demo-advisor");
  await other.chat.hydrate();
  assert.throws(() => other.chat.get(id), /acceso/);
  await assert.rejects(other.chat.send(id, "No", "no"), /lectura/);
});
test("Advisor cannot create groups or publish announcements", async () => {
  const f = setup(undefined, "demo-advisor");
  await f.chat.hydrate();
  await assert.rejects(
    f.chat.create(["demo-owner"], "Grupo", "group"),
    /propietario/,
  );
  await assert.rejects(
    f.chat.send("demo-room-announcements", "Aviso", "send"),
    /lectura/,
  );
});
test("Same-key send is deduplicated after restart and fake attachments enforce 50MB cap", async () => {
  const f = setup();
  await f.chat.hydrate();
  await f.chat.send("demo-room-sales", "Hola", "send");
  const g = setup(f.data);
  await g.chat.hydrate();
  await g.chat.send("demo-room-sales", "Hola", "send");
  assert.equal(g.chat.messages("demo-room-sales").length, 2);
  await assert.rejects(
    g.chat.send("demo-room-sales", "Archivo", "large", {
      name: "sample.pdf",
      bytes: 51 * 1024 * 1024,
    }),
    /Mensaje/,
  );
});
test("Leaving group removes access without destroying history", async () => {
  const f = setup();
  await f.chat.hydrate();
  await f.chat.leave("demo-room-sales", "demo-owner", "leave");
  assert.throws(() => f.chat.messages("demo-room-sales"), /acceso/);
  assert.equal(f.chat.snapshot().doc.messages.length, 1);
});
test("Failed save does not change visible history; explicit retry succeeds", async () => {
  const f = setup();
  await f.chat.hydrate();
  const original = f.io.set;
  f.io.set = async () => {
    throw Error("disk");
  };
  await assert.rejects(f.chat.send("demo-room-sales", "Mensaje", "retry"));
  assert.equal(f.chat.messages("demo-room-sales").length, 1);
  f.io.set = original;
  await f.chat.send("demo-room-sales", "Mensaje", "retry");
  assert.equal(f.chat.messages("demo-room-sales").length, 2);
});
test("Other organization and forged scope do not inherit internal history", async () => {
  const f = setup();
  await f.chat.hydrate();
  await f.chat.send("demo-room-sales", "Privado", "one");
  const g = setup(f.data, "demo-owner", "demo-org-other");
  await g.chat.hydrate();
  assert.equal(g.chat.messages("demo-room-sales").length, 1);
  f.data.set(g.chat.key, f.data.get(f.chat.key)!);
  const h = setup(f.data, "demo-owner", "demo-org-other");
  await h.chat.hydrate();
  assert.equal(h.chat.snapshot().ready, false);
});

test("Shared roster serializes simultaneous sends across actor instances without loss", async () => {
  const f = setup();
  await f.chat.hydrate();
  const other = new TeamChatStore(f.team, "demo-coordinator", f.io);
  await other.hydrate();
  await Promise.all([
    f.chat.send("demo-room-sales", "Uno", "owner"),
    other.send("demo-room-sales", "Dos", "coord"),
  ]);
  await f.chat.reload();
  assert.deepEqual(
    f.chat
      .messages("demo-room-sales")
      .slice(-2)
      .map((m) => m.text)
      .sort(),
    ["Dos", "Uno"],
  );
});
test("Drafts are scoped by actor and room and restored independently", async () => {
  const f = setup();
  await f.chat.hydrate();
  await f.chat.saveDraft("demo-room-sales", "Borrador");
  const other = new TeamChatStore(f.team, "demo-coordinator", f.io);
  await other.hydrate();
  assert.equal(await other.draft("demo-room-sales"), "");
  const g = setup(f.data);
  await g.chat.hydrate();
  assert.equal(await g.chat.draft("demo-room-sales"), "Borrador");
});
test("Direct room displays the counterpart for each reader", async () => {
  const f = setup();
  await f.chat.hydrate();
  const id = await f.chat.create(["demo-coordinator"], null, "direct");
  const other = new TeamChatStore(f.team, "demo-coordinator", f.io);
  await other.hydrate();
  assert.equal(f.chat.title(f.chat.get(id)), "Ana López");
  assert.equal(other.title(other.get(id)), "Fer Ramírez");
});
test("Membership removal before a queued send rejects it", async () => {
  const f = setup();
  await f.chat.hydrate();
  const other = new TeamChatStore(f.team, "demo-advisor", f.io);
  await other.hydrate();
  await f.chat.leave("demo-room-sales", "demo-advisor", "remove");
  await assert.rejects(other.send("demo-room-sales", "No", "stale"), /lectura/);
});

test("Explicit supervision records access and remains read-only; ownership alone cannot read", async () => {
  const f = setup();
  await f.chat.hydrate();
  const other = new TeamChatStore(f.team, "demo-coordinator", f.io);
  await other.hydrate();
  const id = await other.create(["demo-advisor"], null, "private");
  await other.send(id, "Privado", "secret");
  assert.throws(() => f.chat.get(id), /acceso/);
  await assert.rejects(f.chat.openSupervised(id, "no"), /explícito/);
  await f.chat.setSupervisors(["demo-owner"], "permit");
  await f.chat.openSupervised(id, "audit");
  assert.equal(f.chat.messages(id)[0]!.text, "Privado");
  assert.equal(f.chat.snapshot().doc.audit?.length, 1);
  await assert.rejects(f.chat.send(id, "Prohibido", "send"), /lectura/);
  await f.chat.setSupervisors([], "revoke");
  assert.throws(() => f.chat.get(id), /acceso/);
});
test("A failed audit never unlocks a conversation", async () => {
  const f = setup();
  await f.chat.hydrate();
  const other = new TeamChatStore(f.team, "demo-coordinator", f.io);
  await other.hydrate();
  const id = await other.create(["demo-advisor"], null, "private");
  await f.chat.setSupervisors(["demo-owner"], "permit");
  const original = f.io.set;
  f.io.set = async () => {
    throw Error("disk");
  };
  await assert.rejects(f.chat.openSupervised(id, "fail"));
  assert.throws(() => f.chat.get(id));
  f.io.set = original;
});
test("Revocation propagates to a different open instance immediately", async () => {
  const f = setup();
  await f.chat.hydrate();
  const a = new TeamChatStore(f.team, "demo-coordinator", f.io);
  await a.hydrate();
  const id = await a.create(["demo-advisor"], null, "private");
  const viewer = new TeamChatStore(f.team, "demo-owner", f.io);
  await viewer.hydrate();
  await f.chat.setSupervisors(["demo-owner"], "permit");
  await viewer.openSupervised(id, "view");
  await f.chat.setSupervisors([], "revoke");
  assert.throws(() => viewer.messages(id));
});
test("Advisor supervision cannot be granted, and ordinary coordinator cannot delegate", async () => {
  const f = setup();
  await f.chat.hydrate();
  await assert.rejects(f.chat.setSupervisors(["demo-advisor"], "invalid"));
  const c = new TeamChatStore(f.team, "demo-coordinator", f.io);
  await c.hydrate();
  await assert.rejects(c.setSupervisors(["demo-coordinator"], "invalid"));
});

test("Late hydration cannot restore a revoked supervision policy", async () => {
  const f = setup();
  await f.chat.hydrate();
  await f.chat.setSupervisors(["demo-owner"], "permit");
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    entered = new Promise<void>((r) => (started = r));
  const io = {
    ...f.io,
    get: async (k: string) => {
      const raw = await f.io.get(k);
      started();
      await gate;
      return raw;
    },
  };
  const viewer = new TeamChatStore(f.team, "demo-owner", io);
  const loading = viewer.hydrate();
  await entered;
  await f.chat.setSupervisors([], "revoke");
  release();
  await loading;
  assert.equal(viewer.permittedSupervision(), false);
});

test("Internal writer rolls back when the actor is deactivated during storage IO", async () => {
  const f = setup();
  await f.team.hydrate();
  const chat = new TeamChatStore(
    f.team,
    "demo-advisor",
    guardedStorage(f.team, "demo-advisor", f.io),
  );
  await chat.hydrate();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    entered = new Promise<void>((r) => (started = r));
  const original = f.io.set;
  f.io.set = async (k, v) => {
    if (k === chat.key) {
      started();
      await gate;
    }
    await original(k, v);
  };
  const sending = chat.send("demo-room-sales", "No debe persistir", "pending");
  await entered;
  await f.team.update(
    "demo-owner",
    "demo-advisor",
    { role: "advisor", active: false, receiveNew: false, expected: 1 },
    "off",
  );
  release();
  await assert.rejects(sending, /desactivado/);
  assert.equal(f.data.has(chat.key), false);
  assert.equal(chat.snapshot().doc.messages.length, 1);
});
test("A draft read completing after membership removal cannot return protected text", async () => {
  const f = setup();
  await f.chat.hydrate();
  const other = new TeamChatStore(f.team, "demo-advisor", f.io);
  await other.hydrate();
  await other.saveDraft("demo-room-sales", "Borrador privado");
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    entered = new Promise<void>((r) => (started = r)),
    get = f.io.get;
  f.io.get = async (k) => {
    const value = await get(k);
    if (k.includes(".draft.")) {
      started();
      await gate;
    }
    return value;
  };
  const reading = other.draft("demo-room-sales");
  await entered;
  await f.chat.leave("demo-room-sales", "demo-advisor", "remove");
  release();
  await assert.rejects(reading, /acceso/);
});
test("Messages sort chronologically with stable equal-time order and operation receipts cannot cross actors", async () => {
  const f = setup();
  await f.chat.hydrate();
  const late = new TeamChatStore(f.team, "demo-owner", f.io, () => 30);
  await late.hydrate();
  const early = new TeamChatStore(f.team, "demo-coordinator", f.io, () => 10);
  await early.hydrate();
  await late.send("demo-room-sales", "Tarde", "stable");
  await assert.rejects(
    early.send("demo-room-sales", "Tarde", "stable"),
    /otra operación/,
  );
  await early.send("demo-room-sales", "Primero", "early");
  await early.send("demo-room-sales", "Segundo", "equal");
  assert.deepEqual(
    late
      .messages("demo-room-sales")
      .slice(0, 3)
      .map((m) => m.text),
    ["Primero", "Segundo", "Tarde"],
  );
});

test("Delegated groups and Avisos permissions are persisted and revoked effectively", async () => {
  const f = setup();
  await f.chat.hydrate();
  const coord = new TeamChatStore(f.team, "demo-coordinator", f.io),
    advisor = new TeamChatStore(f.team, "demo-advisor", f.io);
  await Promise.all([coord.hydrate(), advisor.hydrate()]);
  assert.equal(coord.canCreateGroups(), false);
  assert.equal(advisor.canPublishAnnouncements(), false);
  await f.chat.setPolicy("coordinatorGroups", true, "groups");
  await f.chat.setPolicy("advisorAnnouncements", true, "avisos");
  assert.equal(coord.canCreateGroups(), true);
  await coord.create(["demo-advisor"], "Grupo delegado", "group");
  await advisor.send("demo-room-announcements", "Aviso ficticio", "notice");
  const restored = setup(f.data);
  await restored.chat.hydrate();
  assert.equal(restored.chat.snapshot().doc.policy?.coordinatorGroups, true);
  assert.equal(restored.chat.snapshot().doc.policy?.advisorAnnouncements, true);
  await f.chat.setPolicy("coordinatorGroups", false, "no-groups");
  await f.chat.setPolicy("advisorAnnouncements", false, "no-avisos");
  await assert.rejects(coord.create(["demo-advisor"], "Bloqueado", "group-no"));
  await assert.rejects(
    advisor.send("demo-room-announcements", "No", "notice-no"),
  );
});
test("Only owner can change policies; invalid fields, values and restored policies are rejected", async () => {
  const f = setup();
  await f.chat.hydrate();
  const c = new TeamChatStore(f.team, "demo-coordinator", f.io);
  await c.hydrate();
  await assert.rejects(
    c.setPolicy("coordinatorGroups", true, "denied"),
    /propietario/,
  );
  await assert.rejects(
    f.chat.setPolicy("unknown" as never, true, "bad-field"),
    /válida/,
  );
  await assert.rejects(
    f.chat.setPolicy("coordinatorGroups", "true" as never, "bad-value"),
    /válida/,
  );
  await f.chat.setPolicy("coordinatorGroups", false, "save");
  const d = JSON.parse(f.data.get(f.chat.key)!);
  d.policy.external = true;
  f.data.set(f.chat.key, JSON.stringify(d));
  const g = setup(f.data);
  await g.chat.hydrate();
  assert.equal(g.chat.snapshot().ready, false);
});
test("Concurrent policy updates merge distinct fields without losing values", async () => {
  const f = setup();
  await f.chat.hydrate();
  await Promise.all([
    f.chat.setPolicy("coordinatorGroups", true, "a"),
    f.chat.setPolicy("advisorAnnouncements", true, "b"),
  ]);
  assert.deepEqual(f.chat.snapshot().doc.policy, {
    coordinatorGroups: true,
    advisorAnnouncements: true,
  });
  assert.equal(Object.isFrozen(f.chat.snapshot().doc.policy), true);
});
test("Queued delegation revocation takes effect before a pending coordinator group creation", async () => {
  const f = setup();
  await f.chat.hydrate();
  const c = new TeamChatStore(f.team, "demo-coordinator", f.io);
  await c.hydrate();
  await f.chat.setPolicy("coordinatorGroups", true, "on");
  const revoking = f.chat.setPolicy("coordinatorGroups", false, "off");
  const creating = c.create(["demo-advisor"], "No debe crearse", "group");
  await revoking;
  await assert.rejects(creating, /delegado/);
  assert.equal(
    c.snapshot().doc.rooms.some((r) => r.name === "No debe crearse"),
    false,
  );
});
test("Policy save failure preserves effective permission and same-key retry remains idempotent", async () => {
  const f = setup();
  await f.chat.hydrate();
  const original = f.io.set;
  f.io.set = async () => {
    throw Error("disk");
  };
  await assert.rejects(f.chat.setPolicy("advisorAnnouncements", true, "retry"));
  assert.equal(f.chat.snapshot().doc.policy?.advisorAnnouncements, false);
  f.io.set = original;
  await f.chat.setPolicy("advisorAnnouncements", true, "retry");
  await f.chat.setPolicy("advisorAnnouncements", true, "retry");
  assert.equal(
    f.chat.snapshot().doc.receipts.filter((r) => r.key === "retry").length,
    1,
  );
});
