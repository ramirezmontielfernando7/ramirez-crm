/** Pure plan validation only: no subprocess, file mutation, network, Docker or database connection. */
export const requiredDisabledWorkers = Object.freeze([
  "campaigns",
  "directQueue",
  "interruptedSends",
  "webhookInbox",
  "unroutedPurge",
  "dailyMetaSync",
  "limitsCheck",
  "forgottenChats",
  "directCheck",
  "kbIndexing",
  "credentialMaintenance",
  "moduleBackfill",
  "orphanRuns",
  "botKeySync",
] as const);
export type AuthOnlyPlan = Readonly<{
  version: 1;
  backendCommit: string;
  project: string;
  hostClass: "local-non-production";
  profile: "auth-only-review-required";
  database: {
    host: string;
    name: string;
    published: false;
    bindings: Readonly<
      Record<
        "application" | "system" | "migration",
        { host: string; database: string; role: string }
      >
    >;
  };
  network: {
    internal: true;
    defaultEgress: "deny";
    ipv6Egress: "deny";
    publicIngress: false;
    dockerSocket: false;
  };
  volumes: readonly string[];
  secretRefs: readonly string[];
  inheritedEnvironment: false;
  workers: Readonly<Record<(typeof requiredDisabledWorkers)[number], false>>;
}>;
export class PreflightFault extends Error {
  constructor(
    readonly code:
      | "invalid-plan"
      | "wrong-commit"
      | "unsafe-database"
      | "unsafe-network"
      | "unsafe-storage"
      | "workers-enabled",
  ) {
    super(code);
  }
}
export function validateAuthOnlyPlan(raw: unknown, reviewedMain: string) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new PreflightFault("invalid-plan");
  const exact = (value: object, keys: readonly string[]) =>
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((k) => keys.includes(k));
  const p = raw as AuthOnlyPlan;
  if (
    !exact(p, [
      "version",
      "backendCommit",
      "project",
      "hostClass",
      "profile",
      "database",
      "network",
      "volumes",
      "secretRefs",
      "inheritedEnvironment",
      "workers",
    ])
  )
    throw new PreflightFault("invalid-plan");
  if (
    p.version !== 1 ||
    p.project !== "dashfort-i2-auth-test" ||
    p.hostClass !== "local-non-production" ||
    p.profile !== "auth-only-review-required" ||
    p.inheritedEnvironment !== false
  )
    throw new PreflightFault("invalid-plan");
  if (!/^[a-f0-9]{40}$/.test(reviewedMain) || p.backendCommit !== reviewedMain)
    throw new PreflightFault("wrong-commit");
  const db = p.database,
    roles = {
      application: "i2p_app",
      system: "i2p_system",
      migration: "i2p_migrate",
    };
  if (
    !db ||
    !exact(db, ["host", "name", "published", "bindings"]) ||
    db.host !== "db.i2p.invalid" ||
    db.name !== "dashfort_auth_test" ||
    db.published !== false ||
    !db.bindings ||
    Object.keys(db.bindings).length !== 3
  )
    throw new PreflightFault("unsafe-database");
  for (const key of Object.keys(roles) as (keyof typeof roles)[]) {
    const d = db.bindings[key];
    if (
      !d ||
      !exact(d, ["host", "database", "role"]) ||
      d.host !== db.host ||
      d.database !== db.name ||
      d.role !== roles[key]
    )
      throw new PreflightFault("unsafe-database");
  }
  const n = p.network;
  if (
    !n ||
    !exact(n, [
      "internal",
      "defaultEgress",
      "ipv6Egress",
      "publicIngress",
      "dockerSocket",
    ]) ||
    n.internal !== true ||
    n.defaultEgress !== "deny" ||
    n.ipv6Egress !== "deny" ||
    n.publicIngress !== false ||
    n.dockerSocket !== false
  )
    throw new PreflightFault("unsafe-network");
  if (
    !Array.isArray(p.volumes) ||
    p.volumes.length !== 2 ||
    new Set(p.volumes).size !== 2 ||
    !p.volumes.every((v) =>
      ["i2p_auth_pg_test", "i2p_auth_media_test"].includes(v),
    ) ||
    !Array.isArray(p.secretRefs) ||
    p.secretRefs.length !== 3 ||
    new Set(p.secretRefs).size !== 3 ||
    !p.secretRefs.every((v) =>
      [
        "fixture-only-app",
        "fixture-only-system",
        "fixture-only-migration",
      ].includes(v),
    )
  )
    throw new PreflightFault("unsafe-storage");
  if (
    !p.workers ||
    Object.keys(p.workers).length !== requiredDisabledWorkers.length ||
    !requiredDisabledWorkers.every((k) => p.workers[k] === false)
  )
    throw new PreflightFault("workers-enabled");
  return Object.freeze({
    staticPlanValid: true,
    readyToStart: false,
    backendCommit: reviewedMain,
    operationalEvidence: "pending",
    ownerAuthorization: "required",
  } as const);
}
