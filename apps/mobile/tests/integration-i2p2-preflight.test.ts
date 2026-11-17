import assert from "node:assert/strict";
import { test } from "node:test";
import {
  requiredDisabledWorkers,
  validateAuthOnlyPlan,
  type AuthOnlyPlan,
} from "../src/integration/preflight";
const main = "3a91d507c535682136b31acefcf2ff63107a2dbd";
function plan(): AuthOnlyPlan {
  return {
    version: 1,
    backendCommit: main,
    project: "dashfort-i2-auth-test",
    hostClass: "local-non-production",
    profile: "auth-only-review-required",
    database: {
      host: "db.i2p.invalid",
      name: "dashfort_auth_test",
      published: false,
      bindings: {
        application: {
          host: "db.i2p.invalid",
          database: "dashfort_auth_test",
          role: "i2p_app",
        },
        system: {
          host: "db.i2p.invalid",
          database: "dashfort_auth_test",
          role: "i2p_system",
        },
        migration: {
          host: "db.i2p.invalid",
          database: "dashfort_auth_test",
          role: "i2p_migrate",
        },
      },
    },
    network: {
      internal: true,
      defaultEgress: "deny",
      ipv6Egress: "deny",
      publicIngress: false,
      dockerSocket: false,
    },
    volumes: ["i2p_auth_pg_test", "i2p_auth_media_test"],
    secretRefs: [
      "fixture-only-app",
      "fixture-only-system",
      "fixture-only-migration",
    ],
    inheritedEnvironment: false,
    workers: Object.fromEntries(
      requiredDisabledWorkers.map((w) => [w, false]),
    ) as AuthOnlyPlan["workers"],
  };
}
test("valid declared auth-only plan never returns authorization or operational readiness", () => {
  const r = validateAuthOnlyPlan(plan(), main);
  assert.equal(r.staticPlanValid, true);
  assert.equal(r.readyToStart, false);
  assert.equal(r.operationalEvidence, "pending");
  assert.equal(r.ownerAuthorization, "required");
});
test("historical mobile root or wrong main SHA is rejected", () => {
  assert.throws(() =>
    validateAuthOnlyPlan(
      { ...plan(), backendCommit: "8d0a1d30777a24f49e2d512296bb0663399c4bbe" },
      main,
    ),
  );
  assert.throws(() => validateAuthOnlyPlan(plan(), "main"));
});
test("each app/system/migration binding must name exactly the isolated database and role", () => {
  for (const k of ["application", "system", "migration"] as const) {
    const p = plan();
    const altered = {
      ...p,
      database: {
        ...p.database,
        bindings: {
          ...p.database.bindings,
          [k]: { ...p.database.bindings[k], host: "unknown-host" },
        },
      },
    };
    assert.throws(() => validateAuthOnlyPlan(altered, main));
    const role = {
      ...p,
      database: {
        ...p.database,
        bindings: {
          ...p.database.bindings,
          [k]: { ...p.database.bindings[k], role: "postgres" },
        },
      },
    };
    assert.throws(() => validateAuthOnlyPlan(role, main));
  }
});
test("database port publication and generic/non-test database names fail closed", () => {
  const p = plan();
  for (const db of [
    { ...p.database, published: true },
    { ...p.database, name: "vocero" },
    { ...p.database, host: "localhost" },
  ])
    assert.throws(() => validateAuthOnlyPlan({ ...p, database: db }, main));
});
test("every worker must be explicitly false; missing and added workers also reject", () => {
  for (const w of requiredDisabledWorkers) {
    const p = plan();
    assert.throws(() =>
      validateAuthOnlyPlan(
        { ...p, workers: { ...p.workers, [w]: true } },
        main,
      ),
    );
  }
  const p = plan();
  assert.throws(() => validateAuthOnlyPlan({ ...p, workers: {} }, main));
  assert.throws(() =>
    validateAuthOnlyPlan(
      { ...p, workers: { ...p.workers, newWorker: false } },
      main,
    ),
  );
});
test("IPv4 and IPv6 egress, ingress and Docker socket are denied independently", () => {
  for (const [k, v] of Object.entries({
    internal: false,
    defaultEgress: "allow",
    ipv6Egress: "allow",
    publicIngress: true,
    dockerSocket: true,
  })) {
    const p = plan();
    assert.throws(() =>
      validateAuthOnlyPlan({ ...p, network: { ...p.network, [k]: v } }, main),
    );
  }
});
test("shared volumes, inherited environment and credential references outside fixtures reject", () => {
  const p = plan();
  assert.throws(() =>
    validateAuthOnlyPlan(
      { ...p, volumes: ["vocero_pg", "i2p_auth_media_test"] },
      main,
    ),
  );
  assert.throws(() =>
    validateAuthOnlyPlan({ ...p, inheritedEnvironment: true }, main),
  );
  assert.throws(() =>
    validateAuthOnlyPlan(
      { ...p, secretRefs: ["old", "secrets", "keys"] },
      main,
    ),
  );
  assert.throws(() =>
    validateAuthOnlyPlan({ ...p, hostClass: "shared-production" }, main),
  );
});
test("arbitrary DSN, password, unknown extra fields and invalid input are not accepted", () => {
  assert.throws(() =>
    validateAuthOnlyPlan({ ...plan(), DATABASE_URL: "do-not-accept" }, main),
  );
  const p = plan();
  assert.throws(() =>
    validateAuthOnlyPlan(
      { ...p, database: { ...p.database, password: "do-not-accept" } },
      main,
    ),
  );
  for (const raw of [null, [], {}, "plan"])
    assert.throws(() => validateAuthOnlyPlan(raw, main));
});
