import assert from "node:assert/strict";
import { test } from "node:test";
import { TeamRepository } from "../src/features/team/core";
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
