import assert from "node:assert/strict";
import { test } from "node:test";
import { PreparedAuth } from "../src/integration/auth/controller";
import { FixtureAuthority } from "../src/integration/auth/fixture";
import { SessionVault } from "../src/integration/auth/vault";
import { decodeSession } from "../src/integration/auth/model";
function setup() {
  const records = new Map<string, string>();
  const server = new FixtureAuthority();
  const vault = new SessionVault(
    {
      get: async (k) => records.get(k) ?? null,
      set: async (k, v) => {
        records.set(k, v);
      },
      remove: async (k) => {
        records.delete(k);
      },
    },
    "fixture-regression",
  );
  let fails = false;
  const cache = new Map<string, string>();
  const boundary = {
    detach() {
      if (fails) throw Error("private cleanup details");
      cache.clear();
    },
    attach() {},
  };
  const c = new PreparedAuth(server, vault, boundary);
  return {
    server,
    vault,
    c,
    records,
    cache,
    boundary,
    fail() {
      fails = true;
    },
  };
}
test("regression 1: observer logout during authenticating prevents authority and persistence", async () => {
  const f = setup();
  let out: Promise<void> | undefined,
    once = false;
  f.c.subscribe(() => {
    if (!once && f.c.snapshot().status === "authenticating") {
      once = true;
      out = f.c.logout();
    }
  });
  await f.c.login("owner@example.invalid", "fixture-password").catch(() => {});
  await out;
  assert.notEqual(f.c.snapshot().status, "authenticated");
  assert.equal(f.records.has(f.vault.key), false);
});
test("regression 2: boundary failure does not skip credential deletion and remote revocation", async () => {
  const f = setup();
  await f.c.login("owner@example.invalid", "fixture-password");
  const saved = (await f.vault.read())!;
  f.cache.set("private", "fixture data");
  f.fail();
  await f.c.logout().catch(() => {});
  assert.equal(f.records.has(f.vault.key), false);
  await assert.rejects(f.server.validate(saved, new AbortController().signal));
  assert.equal(f.c.snapshot().status, "blocked");
  assert.notEqual(f.c.snapshot().error, null);
});
test("regression 3: cold offline restore and logout never report no remote session", async () => {
  const f = setup();
  await f.c.login("owner@example.invalid", "fixture-password");
  const cold = new PreparedAuth(f.server, f.vault, f.boundary);
  f.server.online = false;
  await cold.restore().catch(() => {});
  await cold.logout();
  assert.notEqual(cold.snapshot().remoteRevocation, "none");
  assert.notEqual(cold.snapshot().remoteRevocation, "confirmed");
  assert.equal(f.records.has(f.vault.key), false);
});
test("regression 4: scope projection never retains arbitrary or nested fields", async () => {
  const f = setup();
  await f.c.login("owner@example.invalid", "fixture-password");
  const saved = (await f.vault.read())!;
  const v = decodeSession(
    {
      ...saved,
      context: {
        ...saved.context,
        scope: {
          ...saved.context.scope,
          password: "fixture-private",
          nested: { cookie: "fixture-secret" },
        },
      },
    },
    Date.now(),
  );
  assert.deepEqual(Object.keys(v.context.scope).sort(), [
    "expiresAt",
    "organizationId",
    "sessionId",
    "userId",
  ]);
});
