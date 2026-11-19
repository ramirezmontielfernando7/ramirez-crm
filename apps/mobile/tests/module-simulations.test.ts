import assert from "node:assert/strict";
import { test } from "node:test";
import {
  campaignPreview,
  BookingSimulation,
  teamDestination,
  AgentSimulation,
} from "../src/integration/module-simulations";
const s = {
  userId: "fixture-user",
  organizationId: "fixture-org",
  sessionId: "fixture-session",
  expiresAt: Date.now() + 100000,
};
test("campaign dry run deduplicates and excludes opt-out/unknown without enabling sends", () => {
  const recipients = ["opt-in", "unknown", "opt-out"].map((consent, i) => ({
    id: "fixture-r" + i,
    organizationId: s.organizationId,
    consent: consent as "opt-in" | "unknown" | "opt-out",
    assigned: null,
  }));
  const p = campaignPreview(s, "owner", [...recipients, recipients[0]!], {
    id: "fixture-template",
    organizationId: s.organizationId,
    approved: true,
  });
  assert.equal(p.eligible.length, 1);
  assert.equal(p.excluded.length, 2);
  assert.equal(p.canSend, false);
});
test("campaign preview refuses foreign recipients, unapproved templates and advisor", () => {
  const template = {
    id: "fixture-template",
    organizationId: s.organizationId,
    approved: true,
  };
  assert.throws(() => campaignPreview(s, "asesor", [], template));
  assert.throws(() =>
    campaignPreview(s, "owner", [], { ...template, approved: false }),
  );
  assert.throws(() =>
    campaignPreview(
      s,
      "owner",
      [
        {
          id: "fixture-r",
          organizationId: "fixture-foreign",
          consent: "opt-in",
          assigned: null,
        },
      ],
      template,
    ),
  );
});
test("agenda rejects overlapping slots and stale version updates", () => {
  const b = new BookingSimulation(s, "owner"),
    row = {
      id: "fixture-booking",
      organizationId: s.organizationId,
      assignee: s.userId,
      startsAt: 1,
      endsAt: 1000,
      cancelled: false,
      version: 1,
    };
  b.put(row, null);
  assert.throws(() => b.put({ ...row, id: "fixture-other" }, null));
  assert.throws(() => b.put({ ...row, version: 2 }, null));
  b.put({ ...row, cancelled: true, version: 2 }, 1);
  b.put({ ...row, id: "fixture-other" }, null);
  assert.equal(b.list().length, 2);
  b.clear();
  assert.equal(b.list().length, 0);
});
test("agenda advisor cannot mutate another assignee or organization", () => {
  const b = new BookingSimulation(s, "asesor");
  assert.throws(() =>
    b.put(
      {
        id: "fixture-book",
        organizationId: s.organizationId,
        assignee: "fixture-other",
        startsAt: 1,
        endsAt: 2,
        cancelled: false,
        version: 1,
      },
      null,
    ),
  );
});
test("supervision is audited read-only and cannot become a write route", () => {
  const group = {
    id: "fixture-group",
    organizationId: s.organizationId,
    members: [],
    announcement: false,
  };
  assert.equal(
    teamDestination(s, "owner", group, true, false).auditRequired,
    true,
  );
  assert.throws(() => teamDestination(s, "owner", group, true, true));
  assert.throws(() => teamDestination(s, "asesor", group, true, false));
});
test("announcement members obey role permission and organization", () => {
  const group = {
    id: "fixture-group",
    organizationId: s.organizationId,
    members: [s.userId],
    announcement: true,
  };
  assert.equal(
    teamDestination(s, "asesor", group, false, false).readOnly,
    true,
  );
  assert.throws(() => teamDestination(s, "asesor", group, false, true));
  assert.throws(() =>
    teamDestination(
      s,
      "owner",
      { ...group, organizationId: "fixture-other" },
      false,
      false,
    ),
  );
});
test("agent versions are immutable mock publications without a provider", () => {
  const a = new AgentSimulation(s, "owner");
  const draft = {
    id: "fixture-agent",
    organizationId: s.organizationId,
    version: 1,
    body: "Instrucciones ficticias",
  };
  assert.equal(a.publish(draft).providerEnabled, false);
  draft.body = "changed";
  assert.notEqual(a.snapshot()[0]?.body, draft.body);
  assert.throws(() => a.publish(draft));
  assert.throws(() => new AgentSimulation(s, "coordinador").publish(draft));
});
