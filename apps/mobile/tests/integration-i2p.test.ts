import assert from "node:assert/strict";
import { test } from "node:test";
import { PreparedAuth } from "../src/integration/auth/controller";
import { FixtureAuthority } from "../src/integration/auth/fixture";
import { SessionVault } from "../src/integration/auth/vault";
import {
  AuthFault,
  decodeSession,
  type AuthContext,
  type AuthAuthority,
  type SecretStore,
} from "../src/integration/auth/model";
import {
  requestPlan,
  validateFutureDestination,
  acceptResponseStatus,
  DisabledAuthenticatedHttp,
} from "../src/integration/auth/transport";
import { createDeviceSecretStore } from "../src/integration/auth/secure-store";
function memory() {
  const map = new Map<string, string>();
  let fail = false;
  const port: SecretStore = {
    get: async (k) => {
      if (fail) throw Error("private details");
      return map.get(k) ?? null;
    },
    set: async (k, v) => {
      if (fail) throw Error("private details");
      map.set(k, v);
    },
    remove: async (k) => {
      if (fail) throw Error("private details");
      map.delete(k);
    },
  };
  return {
    port,
    map,
    fail: (v: boolean) => {
      fail = v;
    },
  };
}
function fixture() {
  let now = 2_000_000_000_000;
  const mem = memory(),
    server = new FixtureAuthority(() => now),
    vault = new SessionVault(mem.port, "fixture-device", () => now),
    cache = new Map<string, string>();
  let attached: AuthContext | null = null;
  const boundary = {
    detach: () => {
      cache.clear();
      attached = null;
    },
    attach: (c: AuthContext) => {
      attached = c;
    },
  };
  const controller = new PreparedAuth(server, vault, boundary, () => now);
  return {
    mem,
    server,
    vault,
    controller,
    cache,
    boundary,
    attached: () => attached,
    advance: (n: number) => {
      now += n;
    },
    now: () => now,
  };
}
const login = (
  f: ReturnType<typeof fixture>,
  email = "owner@example.invalid",
) => f.controller.login(email, "fixture-password");
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
test("all three backend roles restore only after canonical authority validation; no password or credential in public snapshot", async () => {
  for (const role of ["owner", "coordinador", "asesor"]) {
    const f = fixture();
    await login(f, `${role}@example.invalid`);
    assert.equal(f.controller.snapshot().context?.role, role);
    assert.ok(
      !JSON.stringify(f.controller.snapshot()).includes("fixture-cookie"),
    );
    assert.ok(![...f.mem.map.values()].join("").includes("fixture-password"));
    await f.controller.restore();
    assert.equal(f.controller.snapshot().status, "authenticated");
  }
});
test("invalid login, storage error and generic server errors fail closed with sanitized diagnostics", async () => {
  const f = fixture();
  await assert.rejects(f.controller.login("owner@example.invalid", "bad"), {
    message: "unauthorized",
  });
  assert.equal(f.controller.snapshot().context, null);
  f.mem.fail(true);
  await assert.rejects(login(f), { message: "storage" });
  assert.equal(f.controller.snapshot().error, "storage");
  assert.ok(
    !JSON.stringify(f.controller.snapshot()).includes("private details"),
  );
});
test("fresh coordinator restores fixture credential through server; forged cached role never grants privileges", async () => {
  const f = fixture();
  await login(f, "asesor@example.invalid");
  const saved = JSON.parse(f.mem.map.get(f.vault.key)!);
  saved.context.role = "owner";
  saved.context.permissions = ["scope.all"];
  f.mem.map.set(f.vault.key, JSON.stringify(saved));
  const next = new PreparedAuth(f.server, f.vault, f.boundary, f.now);
  await next.restore();
  assert.equal(next.snapshot().context?.role, "asesor");
  assert.deepEqual(next.snapshot().context?.permissions, []);
});
test("expired or corrupt persisted envelope is erased; offline restore grants no authority", async () => {
  const f = fixture();
  await login(f);
  f.advance(3600001);
  await assert.rejects(f.controller.restore(), { message: "invalid" });
  assert.equal(f.mem.map.size, 0);
  await login(f);
  f.server.online = false;
  await assert.rejects(f.controller.restore(), { message: "offline" });
  assert.equal(f.controller.snapshot().context, null);
  assert.equal(f.mem.map.size, 1);
  f.server.online = true;
  await f.controller.restore();
  assert.equal(f.controller.snapshot().status, "authenticated");
});
test("refresh coalesces concurrent callers, rotates binding and never revives a logged-out session", async () => {
  const f = fixture();
  await login(f);
  const before = f.controller.snapshot().context!.scope.sessionId;
  const gate = deferred();
  f.server.before = async (op) => {
    if (op === "renew") await gate.promise;
  };
  const first = f.controller.renew(),
    second = f.controller.renew();
  assert.equal(first, second);
  gate.resolve();
  await first;
  assert.notEqual(f.controller.snapshot().context!.scope.sessionId, before);
  const g = deferred();
  f.server.before = async (op) => {
    if (op === "renew") await g.promise;
  };
  const renewing = f.controller.renew();
  await f.controller.logout();
  g.resolve();
  await assert.rejects(renewing, { message: "stale" });
  assert.equal(f.controller.snapshot().context, null);
  assert.equal(f.mem.map.size, 0);
});
test("unsupported renewal and organization switch do not invent a backend capability", async () => {
  const f = fixture();
  f.server.renewable = false;
  await login(f);
  await assert.rejects(f.controller.renew(), { message: "unsupported" });
  await assert.rejects(f.controller.switchOrganization("fixture-org-b"), {
    message: "unsupported",
  });
  assert.equal(
    f.controller.snapshot().context?.scope.organizationId,
    "fixture-org-a",
  );
});
test("organization switch clears scoped caches and discards outstanding request even if signal is ignored", async () => {
  const f = fixture();
  f.server.allowOrganizationSwitch = true;
  await login(f);
  f.cache.set("old", "message");
  const g = deferred();
  const request = f.controller.guarded(async (_c, _signal) => {
    await g.promise;
    return "old response";
  });
  await f.controller.switchOrganization("fixture-org-b");
  assert.equal(f.cache.size, 0);
  assert.equal(
    f.controller.snapshot().context?.scope.organizationId,
    "fixture-org-b",
  );
  g.resolve();
  await assert.rejects(request, { message: "stale" });
});
test("advisor cannot switch to a foreign organization even in proposed mock capability mode", async () => {
  const f = fixture();
  f.server.allowOrganizationSwitch = true;
  await login(f, "asesor@example.invalid");
  await assert.rejects(f.controller.switchOrganization("fixture-org-b"), {
    message: "forbidden",
  });
  assert.equal(f.controller.snapshot().context, null);
  assert.equal(f.mem.map.size, 0);
});
test("late login response cannot overwrite a newer user or persisted credential", async () => {
  const f = fixture();
  const g = deferred(),
    started = deferred();
  let count = 0;
  f.server.before = async (op) => {
    if (op === "login" && ++count === 1) {
      started.resolve();
      await g.promise;
    }
  };
  const old = login(f);
  await started.promise;
  await login(f, "coordinador@example.invalid");
  g.resolve();
  await assert.rejects(old, { message: "stale" });
  assert.equal(f.controller.snapshot().context?.role, "coordinador");
  const saved = await f.vault.read();
  assert.equal(saved?.context.role, "coordinador");
});
test("in-flight secure write followed by logout is removed and never attaches context", async () => {
  const f = fixture();
  const g = deferred(),
    started = deferred();
  const port: SecretStore = {
    ...f.mem.port,
    set: async (k, v) => {
      started.resolve();
      await g.promise;
      await f.mem.port.set(k, v);
    },
  };
  const vault = new SessionVault(port, "fixture-race", f.now),
    c = new PreparedAuth(f.server, vault, f.boundary, f.now);
  const pending = c.login("owner@example.invalid", "fixture-password");
  await started.promise;
  const out = c.logout();
  g.resolve();
  await assert.rejects(pending, { message: "stale" });
  await out;
  assert.equal(await vault.read(), null);
  assert.equal(f.attached(), null);
});
test("server-side revocation and request 401/403 clear secrets, scopes and caches", async () => {
  for (const code of ["unauthorized", "forbidden"] as const) {
    const f = fixture();
    await login(f);
    f.cache.set("old", "private fixture");
    await assert.rejects(
      f.controller.guarded(async () => {
        throw new AuthFault(code);
      }),
      { message: code },
    );
    assert.equal(f.cache.size, 0);
    assert.equal(f.mem.map.size, 0);
    assert.equal(f.controller.snapshot().context, null);
  }
  const f = fixture();
  await login(f);
  const saved = (await f.vault.read())!;
  f.server.forceRevoke(saved);
  await assert.rejects(f.controller.restore(), { message: "unauthorized" });
  assert.equal(f.mem.map.size, 0);
});
test("expiry during a request rejects late response and erases the binding", async () => {
  const f = fixture();
  await login(f);
  await assert.rejects(
    f.controller.guarded(async () => {
      f.advance(3600001);
      return "expired";
    }),
    { message: "unauthorized" },
  );
  assert.equal(f.mem.map.size, 0);
});
test("offline logout clears local authority but reports unconfirmed remote revocation", async () => {
  const f = fixture();
  await login(f);
  f.server.online = false;
  await f.controller.logout();
  assert.equal(f.controller.snapshot().context, null);
  assert.equal(f.controller.snapshot().remoteRevocation, "unconfirmed");
  assert.equal(f.mem.map.size, 0);
});
test("failed local deletion never reports successful secure cleanup", async () => {
  const f = fixture();
  await login(f);
  f.mem.fail(true);
  await assert.rejects(f.controller.logout(), { message: "storage" });
  assert.equal(f.controller.snapshot().context, null);
  assert.equal(f.controller.snapshot().error, "storage");
});
test("restore rejects unexpected authority organization rather than silently rebinding old cache", async () => {
  const f = fixture();
  await login(f);
  const saved = (await f.vault.read())!;
  const authority: AuthAuthority = {
    login: f.server.login.bind(f.server),
    renew: f.server.renew.bind(f.server),
    revoke: f.server.revoke.bind(f.server),
    switchOrganization: f.server.switchOrganization.bind(f.server),
    validate: async () =>
      decodeSession(
        {
          ...saved,
          context: {
            ...saved.context,
            scope: { ...saved.context.scope, organizationId: "fixture-org-b" },
          },
        },
        f.now(),
      ),
  };
  const c = new PreparedAuth(authority, f.vault, f.boundary, f.now);
  await assert.rejects(c.restore(), { message: "invalid" });
  assert.equal(c.snapshot().context, null);
});
test("fixture namespaces reject real-like material and invalid schema; web secure storage never falls back", async () => {
  const f = fixture();
  await login(f);
  const s = (await f.vault.read())!;
  assert.throws(() =>
    decodeSession({ ...s, credential: "real-looking-cookie" }, f.now()),
  );
  assert.throws(() =>
    decodeSession({ ...s, context: { ...s.context, role: "admin" } }, f.now()),
  );
  assert.throws(() => new SessionVault(f.mem.port, "real-device"));
  await assert.rejects(createDeviceSecretStore().get("any"), {
    message: "unsupported",
  });
});
test("future destination validation rejects redirects, cross-origin, URL credentials, fragments and noncanonical paths", async () => {
  const origin = "https://auth-test.example.invalid";
  const valid = origin + "/api/auth/get-session";
  assert.equal(validateFutureDestination(valid, origin), valid);
  for (const u of [
    "http://auth-test.example.invalid/api/auth/get-session",
    "https://other.example.invalid/api/auth/get-session",
    origin + "/api/auth/get-session#fragment",
    origin + "/api/auth/get-session?token=secret",
    origin + "/x/../api/auth/get-session",
    "https://name:pass@auth-test.example.invalid/api/auth/get-session",
  ])
    assert.throws(() => validateFutureDestination(u, origin));
  for (const status of [301, 302, 303, 307, 308])
    assert.throws(() => acceptResponseStatus(status), { message: "redirect" });
  assert.throws(() => acceptResponseStatus(401), { message: "unauthorized" });
  assert.throws(() => acceptResponseStatus(403), { message: "forbidden" });
  await assert.rejects(
    new DisabledAuthenticatedHttp().execute(
      requestPlan("GET", "/api/auth/get-session"),
    ),
    { message: "blocked" },
  );
  assert.throws(() => requestPlan("POST", "/api/auth/organization/set-active"));
});
