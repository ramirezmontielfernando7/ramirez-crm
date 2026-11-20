import assert from "node:assert/strict";
import { test } from "node:test";
import { TeamRepository } from "../src/features/team/core";
import { CatalogStore } from "../src/features/catalog/core";
import { InboxStore } from "../src/features/inbox/store-core";
import { ContactDirectory } from "../src/features/contact/core";
test("Accepted member is assignable through Inbox and persisted contact metadata", async () => {
  const data = new Map<string, string>(),
    storage = {
      get: async (k: string) => data.get(k) ?? null,
      set: async (k: string, v: string) => {
        data.set(k, v);
      },
      remove: async (k: string) => {
        data.delete(k);
      },
    };
  const roster = new TeamRepository("demo-org-cristal", storage);
  await roster.hydrate();
  const invitation = await roster.invite(
      "demo-owner",
      { name: "QA ficticio", email: "qa@example.test", role: "advisor" },
      "invite",
    ),
    member = await roster.accept(invitation, "accept");
  const actor = { id: "demo-owner", role: "owner" as const },
    inbox = new InboxStore(actor, new CatalogStore(actor), roster),
    dir = new ContactDirectory(
      inbox.actor,
      inbox.repository,
      storage,
      inbox.reload,
    );
  const contact = dir.get("demo-conv-1");
  await contact.hydrate();
  await contact.assign(member);
  assert.equal(inbox.repository.get(actor, contact.id).assigned, member);
  await contact.hydrate();
  assert.equal(contact.snapshot().data.assigned, member);
  await roster.update(
    "demo-owner",
    member,
    { role: "advisor", active: false, receiveNew: false, expected: 2 },
    "off",
  );
  await assert.rejects(dir.get("demo-conv-2").assign(member));
  assert.throws(() => inbox.repository.assign(actor, ["demo-conv-2"], member));
});
test("Existing Inbox actor cannot retain owner permissions after demotion", async () => {
  const data = new Map<string, string>(),
    storage = {
      get: async (k: string) => data.get(k) ?? null,
      set: async (k: string, v: string) => {
        data.set(k, v);
      },
    };
  const roster = new TeamRepository("demo-org-cristal", storage);
  await roster.hydrate();
  const owner = { id: "demo-owner", role: "owner" as const },
    inbox = new InboxStore(owner, new CatalogStore(owner), roster);
  await roster.update(
    owner.id,
    "demo-advisor",
    { role: "owner", active: true, receiveNew: true, expected: 1 },
    "other-owner",
  );
  await roster.update(
    owner.id,
    owner.id,
    { role: "advisor", active: true, receiveNew: true, expected: 1 },
    "demote",
  );
  assert.equal(inbox.actor.role, "advisor");
  assert.throws(() =>
    inbox.repository.assign(owner, ["demo-conv-1"], "demo-advisor"),
  );
  assert.throws(() => inbox.repository.get(owner, "demo-conv-2"));
});
