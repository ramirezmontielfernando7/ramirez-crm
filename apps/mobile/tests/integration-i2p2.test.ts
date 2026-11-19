import assert from "node:assert/strict";
import { test } from "node:test";
import { PreparedAuth } from "../src/integration/auth/controller";
import { SessionVault } from "../src/integration/auth/vault";
import { FixtureAuthority } from "../src/integration/auth/fixture";
import {
  AuthFault,
  decodeSession,
  type AuthAuthority,
  type SecretStore,
} from "../src/integration/auth/model";
function memory() {
  const data = new Map<string, string>();
  let fail = (op: string, k: string) => false;
  const operations: string[] = [];
  const store: SecretStore = {
    get: async (k) => {
      operations.push("get:" + k);
      if (fail("get", k)) throw Error("private error");
      return data.get(k) ?? null;
    },
    set: async (k, v) => {
      operations.push("set:" + k);
      if (fail("set", k)) throw Error("private error");
      data.set(k, v);
    },
    remove: async (k) => {
      operations.push("remove:" + k);
      if (fail("remove", k)) throw Error("private error");
      data.delete(k);
    },
  };
  return {
    data,
    operations,
    store,
    fail: (fn: typeof fail) => {
      fail = fn;
    },
  };
}
function fixture() {
  const m = memory(),
    server = new FixtureAuthority(),
    vault = new SessionVault(m.store, "fixture-p2"),
    cache = new Map();
  let broken = false;
  const boundary = {
    detach() {
      if (broken) throw Error("sensitive details");
      cache.clear();
    },
    attach() {},
  };
  const c = new PreparedAuth(server, vault, boundary);
  return {
    m,
    server,
    vault,
    c,
    cache,
    boundary,
    broken: (v: boolean) => {
      broken = v;
    },
  };
}
const login = (f: ReturnType<typeof fixture>) =>
  f.c.login("owner@example.invalid", "fixture-password");
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function authority(server: FixtureAuthority): AuthAuthority {
  return {
    login: server.login.bind(server),
    validate: server.validate.bind(server),
    renew: server.renew.bind(server),
    switchOrganization: server.switchOrganization.bind(server),
    revoke: server.revoke.bind(server),
    revokeReference: server.revokeReference.bind(server),
  };
}
test("observer exception cannot stop other observers or any logout cleanup", async () => {
  const f = fixture();
  await login(f);
  let notified = 0;
  f.c.subscribe(() => {
    throw Error("sensitive subscriber");
  });
  f.c.subscribe(() => {
    notified++;
  });
  await f.c.logout();
  assert.ok(notified > 0);
  assert.ok(f.c.snapshot().observerFailures > 0);
  assert.equal(f.c.snapshot().remoteRevocation, "confirmed");
  assert.equal(f.m.data.has(f.vault.key), false);
  assert.ok(!JSON.stringify(f.c.snapshot()).includes("sensitive"));
});
test("reentrant login switches to newer user; obsolete login never calls authority", async () => {
  const f = fixture();
  let once = false,
    newer: Promise<void> | undefined;
  f.c.subscribe(() => {
    if (!once && f.c.snapshot().status === "authenticating") {
      once = true;
      newer = f.c.login("coordinador@example.invalid", "fixture-password");
    }
  });
  await assert.rejects(login(f), { message: "stale" });
  await newer;
  assert.equal(f.c.snapshot().context?.role, "coordinador");
  assert.equal((await f.vault.read())?.context.role, "coordinador");
});
test("successful login ignoring AbortSignal after logout never persists active credentials and is revoked", async () => {
  const f = fixture(),
    g = deferred(),
    started = deferred();
  let issued: Awaited<ReturnType<FixtureAuthority["login"]>>;
  const a = authority(f.server);
  a.login = async (email, password) => {
    issued = await f.server.login(
      email,
      password,
      new AbortController().signal,
    );
    started.resolve();
    await g.promise;
    return issued;
  };
  const c = new PreparedAuth(a, f.vault, f.boundary);
  const late = c.login("owner@example.invalid", "fixture-password");
  await started.promise;
  await c.logout();
  g.resolve();
  await assert.rejects(late, { message: "stale" });
  assert.equal(c.snapshot().context, null);
  assert.equal(f.m.data.has(f.vault.key), false);
  await assert.rejects(
    f.server.validate(issued!, new AbortController().signal),
  );
  assert.ok(![...f.m.data.values()].join("").includes("fixture-cookie"));
});
test("multiple successful logins out of order keep only newest scope and revoke the orphan", async () => {
  const f = fixture(),
    g = deferred(),
    started = deferred();
  let first = true;
  let old: Awaited<ReturnType<FixtureAuthority["login"]>>;
  const a = authority(f.server);
  a.login = async (email, password) => {
    const s = await f.server.login(
      email,
      password,
      new AbortController().signal,
    );
    if (first) {
      first = false;
      old = s;
      started.resolve();
      await g.promise;
    }
    return s;
  };
  const c = new PreparedAuth(a, f.vault, f.boundary);
  const p = c.login("owner@example.invalid", "fixture-password");
  await started.promise;
  await c.login("asesor@example.invalid", "fixture-password");
  g.resolve();
  await assert.rejects(p, { message: "stale" });
  assert.equal(c.snapshot().context?.role, "asesor");
  assert.equal((await f.vault.read())?.context.role, "asesor");
  await assert.rejects(f.server.validate(old!, new AbortController().signal));
});
test("boundary failure still deletes credential/revokes, blocks new access until cleanup is repaired", async () => {
  const f = fixture();
  await login(f);
  f.cache.set("old", "data");
  f.broken(true);
  await assert.rejects(f.c.logout(), { message: "cleanup" });
  assert.ok(f.c.snapshot().cleanupFailures.includes("boundary"));
  assert.equal(f.m.data.has(f.vault.key), false);
  assert.equal(f.c.snapshot().remoteRevocation, "confirmed");
  await assert.rejects(login(f), { message: "cleanup" });
  f.broken(false);
  await f.c.logout();
  await login(f);
  assert.equal(f.cache.size, 0);
});
test("credential deletion failure persists a logout barrier and blocks restore after coordinator restart", async () => {
  const f = fixture();
  await login(f);
  f.m.fail((op, k) => op === "remove" && k === f.vault.key);
  await assert.rejects(f.c.logout(), { message: "cleanup" });
  assert.ok(f.c.snapshot().cleanupFailures.includes("credential-delete"));
  assert.equal(f.m.data.get(f.vault.barrierKey), "blocked-v1");
  const next = new PreparedAuth(
    f.server,
    new SessionVault(f.m.store, "fixture-p2"),
    f.boundary,
  );
  await assert.rejects(next.restore(), { message: "blocked" });
  assert.equal(next.snapshot().context, null);
  assert.equal(f.c.snapshot().remoteRevocation, "confirmed");
});
test("barrier write failure does not skip credential removal or remote revocation", async () => {
  const f = fixture();
  await login(f);
  f.m.fail((op, k) => op === "set" && k === f.vault.barrierKey);
  await assert.rejects(f.c.logout(), { message: "cleanup" });
  assert.equal(f.m.data.has(f.vault.key), false);
  assert.ok(f.c.snapshot().cleanupFailures.includes("restore-barrier"));
  assert.equal(f.c.snapshot().remoteRevocation, "confirmed");
  await assert.rejects(f.vault.read(), { message: "blocked" });
});
test("all local storage operations failing never reports cleanup or revocation certainty", async () => {
  const f = fixture();
  await login(f);
  f.m.fail(() => true);
  await assert.rejects(f.c.logout(), { message: "cleanup" });
  assert.equal(f.c.snapshot().status, "blocked");
  assert.equal(f.c.snapshot().context, null);
  assert.equal(f.c.snapshot().remoteRevocation, "unknown");
  await assert.rejects(f.vault.read());
});
test("journal write failure does not skip deleting active credentials and never leaks error text", async () => {
  const f = fixture();
  await login(f);
  f.m.fail((op, k) => op === "set" && k === f.vault.revocationsKey);
  await assert.rejects(f.c.logout(), { message: "cleanup" });
  assert.equal(f.m.data.has(f.vault.key), false);
  assert.ok(f.c.snapshot().cleanupFailures.includes("revocation-write"));
  assert.equal(f.c.snapshot().remoteRevocation, "unknown");
  assert.ok(!JSON.stringify(f.c.snapshot()).includes("private"));
});
test("cold offline restore/logout persists credential-free pending references and recovers after restart", async () => {
  const f = fixture();
  await login(f);
  const saved = (await f.vault.read())!;
  const cold = new PreparedAuth(
    f.server,
    new SessionVault(f.m.store, "fixture-p2"),
    f.boundary,
  );
  f.server.online = false;
  await assert.rejects(cold.restore(), { message: "offline" });
  await cold.logout();
  assert.equal(cold.snapshot().remoteRevocation, "pending");
  assert.ok(![...f.m.data.values()].join("").includes(saved.credential));
  const restarted = new PreparedAuth(
    f.server,
    new SessionVault(f.m.store, "fixture-p2"),
    f.boundary,
  );
  await assert.rejects(restarted.restore(), { message: "blocked" });
  assert.equal(restarted.snapshot().remoteRevocation, "pending");
  f.server.online = true;
  await restarted.recoverRevocations();
  assert.equal(restarted.snapshot().remoteRevocation, "confirmed");
  assert.equal((await f.vault.listRevocations()).length, 0);
  await assert.rejects(f.server.validate(saved, new AbortController().signal));
});
test("failed versus uncertain remote outcomes survive without being called confirmed", async () => {
  for (const code of ["forbidden", "server"] as const) {
    const f = fixture();
    await login(f);
    const a = authority(f.server);
    a.revoke = async () => {
      throw new AuthFault(code);
    };
    const c = new PreparedAuth(a, f.vault, f.boundary);
    await c.restore();
    await c.logout();
    assert.equal(
      c.snapshot().remoteRevocation,
      code === "forbidden" ? "failed" : "unknown",
    );
    const cold = new PreparedAuth(
      f.server,
      new SessionVault(f.m.store, "fixture-p2"),
      f.boundary,
    );
    await cold.recoverRevocations();
    assert.equal(cold.snapshot().remoteRevocation, "confirmed");
  }
});
test("unknown remote result may already have revoked; retry reference is idempotent in fixture", async () => {
  const f = fixture();
  await login(f);
  const a = authority(f.server);
  a.revoke = async (s) => {
    await f.server.revoke(s);
    throw Error("response lost");
  };
  const c = new PreparedAuth(a, f.vault, f.boundary);
  await c.restore();
  await c.logout();
  assert.equal(c.snapshot().remoteRevocation, "unknown");
  const cold = new PreparedAuth(
    f.server,
    new SessionVault(f.m.store, "fixture-p2"),
    f.boundary,
  );
  await cold.recoverRevocations();
  assert.equal(cold.snapshot().remoteRevocation, "confirmed");
});
test("no server reference revocation capability after restart stays unknown", async () => {
  const f = fixture();
  await login(f);
  f.server.online = false;
  await f.c.logout();
  f.server.online = true;
  const a = authority(f.server);
  delete a.revokeReference;
  const cold = new PreparedAuth(
    a,
    new SessionVault(f.m.store, "fixture-p2"),
    f.boundary,
  );
  await cold.recoverRevocations();
  assert.equal(cold.snapshot().remoteRevocation, "unknown");
});
test("fresh empty logout is the only no-known-session outcome", async () => {
  const f = fixture();
  await f.c.logout();
  assert.equal(f.c.snapshot().remoteRevocation, "none");
  assert.equal(f.c.snapshot().status, "anonymous");
});
test("orphan cleanup failure persists only reference, never credential from invalidated operation", async () => {
  const f = fixture(),
    g = deferred(),
    started = deferred();
  const a = authority(f.server);
  a.login = async (e, p) => {
    const s = await f.server.login(e, p, new AbortController().signal);
    started.resolve();
    await g.promise;
    return s;
  };
  a.revoke = async () => {
    throw new AuthFault("offline");
  };
  const c = new PreparedAuth(a, f.vault, f.boundary);
  const late = c.login("owner@example.invalid", "fixture-password");
  await started.promise;
  await c.logout();
  g.resolve();
  await assert.rejects(late, { message: "stale" });
  assert.equal(c.snapshot().remoteRevocation, "pending");
  assert.equal(f.m.data.has(f.vault.key), false);
  assert.ok(![...f.m.data.values()].join("").includes("fixture-cookie"));
  assert.equal((await f.vault.listRevocations()).length, 1);
});
test("scope allowlist strips malicious nested/additional properties and freezes canonical fields", async () => {
  const f = fixture();
  await login(f);
  const s = (await f.vault.read())!;
  const raw = JSON.parse(JSON.stringify(s));
  raw.context.scope.secret = { token: "not-retained" };
  raw.context.scope.__proto__ = { polluted: "x" };
  raw.extra = "root-secret";
  raw.context.extra = "context-secret";
  const clean = decodeSession(raw, Date.now());
  assert.equal(JSON.stringify(clean).includes("secret"), false);
  assert.equal(Object.hasOwn(clean.context.scope, "polluted"), false);
  assert.ok(Object.isFrozen(clean.context.scope));
  for (const invalid of [
    null,
    [],
    { ...s.context.scope, userId: {} },
    { ...s.context.scope, expiresAt: "tomorrow" },
  ])
    assert.throws(() =>
      decodeSession(
        { ...s, context: { ...s.context, scope: invalid } },
        Date.now(),
      ),
    );
});
test("active scope B cannot receive late request data from scope A", async () => {
  const f = fixture();
  f.server.allowOrganizationSwitch = true;
  await login(f);
  const g = deferred();
  const read = f.c.guarded(async () => {
    await g.promise;
    return { organizationId: "fixture-org-a", text: "old" };
  });
  await f.c.switchOrganization("fixture-org-b");
  g.resolve();
  await assert.rejects(read, { message: "stale" });
  assert.equal(f.c.snapshot().context?.scope.organizationId, "fixture-org-b");
});
test("reentrant new login during logout is never erased or remotely revoked by older cleanup", async () => {
  const f = fixture();
  await login(f);
  const saved = (await f.vault.read())!;
  let once = false,
    newer: Promise<void> | undefined;
  f.c.subscribe(() => {
    if (!once && f.c.snapshot().status === "anonymous") {
      once = true;
      newer = f.c.login("asesor@example.invalid", "fixture-password");
    }
  });
  const old = f.c.logout();
  await assert.rejects(old, { message: "stale" });
  await newer;
  assert.equal(f.c.snapshot().context?.role, "asesor");
  const active = (await f.vault.read())!;
  await f.server.validate(active, new AbortController().signal);
  await assert.rejects(f.server.validate(saved, new AbortController().signal));
});
test("revocation journal read failure still removes credential, attempts known revocation and reports unknown", async () => {
  const f = fixture();
  await login(f);
  const saved = (await f.vault.read())!;
  f.m.fail((op, k) => op === "get" && k === f.vault.revocationsKey);
  await assert.rejects(f.c.logout(), { message: "cleanup" });
  assert.equal(f.m.data.has(f.vault.key), false);
  assert.ok(f.c.snapshot().cleanupFailures.includes("revocation-read"));
  assert.equal(f.c.snapshot().remoteRevocation, "unknown");
  await assert.rejects(f.server.validate(saved, new AbortController().signal));
});
test("credential discovery read failure still deletes binding and revokes known in-memory session", async () => {
  const f = fixture();
  await login(f);
  const saved = (await f.vault.read())!;
  f.m.fail((op, k) => op === "get" && k === f.vault.key);
  await assert.rejects(f.c.logout(), { message: "cleanup" });
  assert.equal(f.m.data.has(f.vault.key), false);
  assert.equal(f.c.snapshot().remoteRevocation, "unknown");
  await assert.rejects(f.server.validate(saved, new AbortController().signal));
});
test("revocation can be retried concurrently without duplicate recovery flights", async () => {
  const f = fixture();
  await login(f);
  f.server.online = false;
  await f.c.logout();
  f.server.online = true;
  const a = f.c.recoverRevocations(),
    b = f.c.recoverRevocations();
  assert.equal(a, b);
  await a;
  assert.equal(f.c.snapshot().remoteRevocation, "confirmed");
});

test("composite cleanup attempts every cache/draft/media/notification participant independently", async () => {
  const { CompositeSessionBoundary } =
    await import("../src/integration/auth/boundary");
  const f = fixture();
  const tried: string[] = [];
  let broken = false;
  const parts = (["cache", "drafts", "media", "notifications"] as const).map(
    (name) => ({
      name,
      attach() {},
      detach() {
        tried.push(name);
        if (broken && ["cache", "drafts"].includes(name))
          throw Error("private resource");
      },
    }),
  );
  const composite = new CompositeSessionBoundary(parts);
  const c = new PreparedAuth(f.server, f.vault, composite);
  await c.login("owner@example.invalid", "fixture-password");
  tried.length = 0;
  broken = true;
  await assert.rejects(c.logout(), { message: "cleanup" });
  assert.deepEqual(tried, ["cache", "drafts", "media", "notifications"]);
  assert.ok(c.snapshot().cleanupFailures.includes("cache"));
  assert.ok(c.snapshot().cleanupFailures.includes("drafts"));
  assert.equal(f.m.data.has(f.vault.key), false);
  assert.equal(c.snapshot().remoteRevocation, "confirmed");
});
test("failed scope attach rolls all participants back without authorizing session", async () => {
  const { CompositeSessionBoundary } =
    await import("../src/integration/auth/boundary");
  const f = fixture(),
    attached = new Set<string>();
  const parts = (["cache", "drafts", "media", "notifications"] as const).map(
    (name) => ({
      name,
      attach() {
        attached.add(name);
        if (name === "media") throw Error("attach failure");
      },
      detach() {
        attached.delete(name);
      },
    }),
  );
  const c = new PreparedAuth(
    f.server,
    f.vault,
    new CompositeSessionBoundary(parts),
  );
  await assert.rejects(c.login("owner@example.invalid", "fixture-password"), {
    message: "cleanup",
  });
  assert.equal(attached.size, 0);
  assert.equal(c.snapshot().context, null);
  assert.equal(f.m.data.has(f.vault.key), false);
});

test("bounded candidate saturation cannot skip logout erasure or known remote revocations", async () => {
  const f = fixture();
  const issued = [];
  for (let i = 0; i < 33; i++) {
    await login(f);
    issued.push((await f.vault.read())!);
  }
  await assert.rejects(login(f), { message: "blocked" });
  await f.c.logout().catch((e) => assert.equal(e.code, "cleanup"));
  assert.equal(f.m.data.has(f.vault.key), false);
  assert.equal(f.c.snapshot().context, null);
  for (const s of issued)
    await assert.rejects(f.server.validate(s, new AbortController().signal));
});

test("failed active credential persistence still revokes the newly issued server session", async () => {
  const f = fixture(),
    a = authority(f.server);
  let issued: Awaited<ReturnType<FixtureAuthority["login"]>>;
  a.login = async (email, password, signal) => {
    issued = await f.server.login(email, password, signal);
    return issued;
  };
  f.m.fail((op, k) => op === "set" && k === f.vault.key);
  const c = new PreparedAuth(a, f.vault, f.boundary);
  await assert.rejects(c.login("owner@example.invalid", "fixture-password"), {
    message: "storage",
  });
  assert.equal(c.snapshot().context, null);
  assert.equal(f.m.data.has(f.vault.key), false);
  await assert.rejects(
    f.server.validate(issued!, new AbortController().signal),
  );
});

for (const operation of ["renew", "switch"] as const) {
  test(`successful late ${operation} ignoring AbortSignal cannot restore authority after logout`, async () => {
    const f = fixture(),
      a = authority(f.server),
      started = deferred(),
      release = deferred();
    f.server.allowOrganizationSwitch = true;
    let issued: Awaited<ReturnType<FixtureAuthority["login"]>>;
    if (operation === "renew")
      a.renew = async (s) => {
        issued = await f.server.renew(s, new AbortController().signal);
        started.resolve();
        await release.promise;
        return issued;
      };
    else
      a.switchOrganization = async (s, org) => {
        issued = await f.server.switchOrganization(
          s,
          org,
          new AbortController().signal,
        );
        started.resolve();
        await release.promise;
        return issued;
      };
    const c = new PreparedAuth(a, f.vault, f.boundary);
    await c.login("owner@example.invalid", "fixture-password");
    const late =
      operation === "renew" ? c.renew() : c.switchOrganization("fixture-org-b");
    await started.promise;
    await c.logout();
    release.resolve();
    await assert.rejects(late, { message: "stale" });
    assert.equal(c.snapshot().context, null);
    assert.equal(f.m.data.has(f.vault.key), false);
    await assert.rejects(
      f.server.validate(issued!, new AbortController().signal),
    );
  });
}

test("each independent boundary participant failure is diagnosed without skipping the other three", async () => {
  const { CompositeSessionBoundary } =
    await import("../src/integration/auth/boundary");
  for (const failed of ["cache", "drafts", "media", "notifications"] as const) {
    const f = fixture(),
      tried: string[] = [];
    let broken = false;
    const c = new PreparedAuth(
      f.server,
      f.vault,
      new CompositeSessionBoundary(
        (["cache", "drafts", "media", "notifications"] as const).map(
          (name) => ({
            name,
            attach() {},
            detach() {
              tried.push(name);
              if (broken && name === failed) throw Error("private");
            },
          }),
        ),
      ),
    );
    await c.login("owner@example.invalid", "fixture-password");
    tried.length = 0;
    broken = true;
    await assert.rejects(c.logout(), { message: "cleanup" });
    assert.deepEqual(tried, ["cache", "drafts", "media", "notifications"]);
    assert.ok(c.snapshot().cleanupFailures.includes(failed));
    assert.equal(f.m.data.has(f.vault.key), false);
    assert.equal(c.snapshot().remoteRevocation, "confirmed");
  }
});

test("logout during a participant attach stops remaining stores and rolls back sensitive state", async () => {
  const { CompositeSessionBoundary } =
    await import("../src/integration/auth/boundary");
  const f = fixture(),
    stores = new Map();
  let c: PreparedAuth,
    out: Promise<void> | undefined,
    once = false;
  const parts = (["cache", "drafts", "media", "notifications"] as const).map(
    (name) => ({
      name,
      detach() {
        stores.delete(name);
      },
      attach() {
        stores.set(name, "fixture data");
        if (name === "cache" && !once) {
          once = true;
          out = c.logout();
        }
      },
    }),
  );
  c = new PreparedAuth(f.server, f.vault, new CompositeSessionBoundary(parts));
  await assert.rejects(c.login("owner@example.invalid", "fixture-password"), {
    message: "stale",
  });
  await out;
  assert.equal(stores.size, 0);
  assert.equal(c.snapshot().context, null);
  assert.equal(f.m.data.has(f.vault.key), false);
});
test("restore journal failure propagates and never installs authority", async () => {
  const f = fixture();
  await login(f);
  f.m.fail((op, k) => op === "get" && k === f.vault.revocationsKey);
  const c = new PreparedAuth(
    f.server,
    new SessionVault(f.m.store, "fixture-p2"),
    f.boundary,
  );
  await assert.rejects(c.restore(), { message: "cleanup" });
  assert.equal(c.snapshot().context, null);
  assert.equal(c.snapshot().status, "blocked");
  assert.ok(c.snapshot().cleanupFailures.includes("revocation-read"));
});
test("recovery does not revoke an observed binding while a validated restore response is delayed", async () => {
  const f = fixture();
  await login(f);
  const a = authority(f.server),
    started = deferred(),
    release = deferred();
  a.validate = async (s) => {
    const v = await f.server.validate(s, new AbortController().signal);
    started.resolve();
    await release.promise;
    return v;
  };
  const c = new PreparedAuth(a, f.vault, f.boundary);
  const p = c.restore();
  await started.promise;
  await c.recoverRevocations();
  release.resolve();
  await p;
  const active = (await f.vault.read())!;
  await f.server.validate(active, new AbortController().signal);
  assert.equal(c.snapshot().status, "authenticated");
  assert.equal(c.snapshot().remoteRevocation, "none");
});
test("simultaneous offline and total storage failure stays blocked; no false durable logout guarantee", async () => {
  const f = fixture();
  await login(f);
  f.server.online = false;
  f.m.fail(() => true);
  await assert.rejects(f.c.logout(), { message: "cleanup" });
  assert.equal(f.c.snapshot().status, "blocked");
  assert.equal(f.c.snapshot().remoteRevocation, "unknown");
  assert.equal(f.m.data.has(f.vault.key), true);
  assert.equal(f.m.data.has(f.vault.barrierKey), false);
  f.m.fail(() => false);
  f.server.online = true;
  await f.c.logout();
  assert.equal(f.m.data.has(f.vault.key), false);
  assert.equal(f.c.snapshot().remoteRevocation, "confirmed");
});
test("a newer login triggered inside attach survives obsolete cleanup and keeps its stores", async () => {
  const { CompositeSessionBoundary } =
    await import("../src/integration/auth/boundary");
  const f = fixture(),
    values = new Map<string, string>();
  let c: PreparedAuth,
    once = false,
    next: Promise<void> | undefined,
    out: Promise<void> | undefined;
  const parts = (["cache", "drafts", "media", "notifications"] as const).map(
    (name) => ({
      name,
      detach() {
        values.delete(name);
      },
      attach(context: import("../src/integration/auth/model").AuthContext) {
        values.set(name, context.scope.userId);
        if (!once && context.role === "owner") {
          once = true;
          out = c.logout().catch((e) => {
            assert.equal(e.code, "stale");
          });
          next = c.login("asesor@example.invalid", "fixture-password");
        }
      },
    }),
  );
  c = new PreparedAuth(f.server, f.vault, new CompositeSessionBoundary(parts));
  await assert.rejects(c.login("owner@example.invalid", "fixture-password"), {
    message: "stale",
  });
  await out;
  await next;
  assert.equal(c.snapshot().context?.role, "asesor");
  assert.deepEqual([...values.values()], Array(4).fill("fixture-asesor"));
  await f.server.validate(
    (await f.vault.read())!,
    new AbortController().signal,
  );
});
