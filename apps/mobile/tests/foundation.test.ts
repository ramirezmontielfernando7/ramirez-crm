import assert from "node:assert/strict";
import { test } from "node:test";
import { DemoAuthRepository, DEMO_PASSWORD } from "../src/services/demo-auth";
import {
  canAccess,
  isSession,
  resolveBack,
  SESSION_TTL,
  validateLogin,
  validatePassword,
  visibleModules,
} from "../src/domain/access";
import type { StoragePort } from "../src/services/storage";
function storage(): StoragePort & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
  };
}
test("navigation exposes exactly 5 / 4 / 3 modules and checks direct access", () => {
  assert.deepEqual(visibleModules("owner"), [
    "inbox",
    "crm",
    "studio",
    "marketing",
    "more",
  ]);
  assert.deepEqual(visibleModules("coordinator"), [
    "inbox",
    "crm",
    "marketing",
    "more",
  ]);
  assert.deepEqual(visibleModules("advisor"), ["inbox", "crm", "more"]);
  assert.equal(canAccess("advisor", "marketing"), false);
  assert.equal(canAccess("coordinator", "studio"), false);
  assert.equal(canAccess("owner", "studio", ["studio"]), false);
  assert.deepEqual(
    visibleModules("owner", ["studio"]),
    visibleModules("coordinator"),
  );
});
test("login validates form and never accepts arbitrary accounts or empty passwords", async () => {
  assert.ok(validateLogin("bad", "").email);
  assert.ok(validateLogin("x@y.mx", "").password);
  const repo = new DemoAuthRepository(storage());
  await assert.rejects(
    repo.signIn("persona@empresa.mx", DEMO_PASSWORD),
    /Correo o contraseña incorrectos/,
  );
  await assert.rejects(
    repo.signIn("fer@ejemplo.mx", "bad"),
    /Correo o contraseña incorrectos/,
  );
  assert.ok(validatePassword("short", "other").password);
  assert.ok(validatePassword("12345678", "other").confirmation);
});
test("session lasts 30 days, survives a new repository and is removed on logout", async () => {
  const s = storage();
  const now = 1234567;
  const repo = new DemoAuthRepository(s, () => now);
  const login = await repo.signIn(" FER@EJEMPLO.MX ", DEMO_PASSWORD);
  assert.equal(login.expiresAt, now + SESSION_TTL);
  assert.equal(login.role, "owner");
  assert.deepEqual(
    await new DemoAuthRepository(s, () => now + 100).restore(),
    login,
  );
  assert.equal([...s.values.values()].join("").includes(DEMO_PASSWORD), false);
  await repo.signOut();
  assert.equal(await repo.restore(), null);
});
test("expired, corrupt and forged sessions fail closed and are cleared", async () => {
  const s = storage();
  const now = 2000;
  const repo = new DemoAuthRepository(s, () => now);
  const session = await repo.signIn("asesor@ejemplo.mx", DEMO_PASSWORD);
  assert.equal(isSession({ ...session, role: "admin" }, now), false);
  assert.equal(isSession({ ...session, expiresAt: Infinity }, now), false);
  assert.equal(isSession({ ...session, source: "production" }, now), false);
  const expired = new DemoAuthRepository(s, () => now + SESSION_TTL);
  assert.equal(await expired.restore(), null);
  assert.equal(s.values.size, 0);
  s.values.set("dashfort.demo.session.v1", "{broken");
  assert.equal(await repo.restore(), null);
});
test("activation and reset enforce valid single-use links independently", async () => {
  const s = storage();
  const repo = new DemoAuthRepository(s);
  await assert.rejects(
    repo.redeem("expired", "12345678", "activate"),
    /venció/,
  );
  await assert.rejects(
    repo.redeem("demo-activate", "short", "activate"),
    /8 caracteres/,
  );
  assert.equal(
    (await repo.redeem("demo-activate", "12345678", "activate")).role,
    "advisor",
  );
  await repo.signOut();
  await assert.rejects(
    new DemoAuthRepository(s).redeem("demo-activate", "12345678", "activate"),
    /ya se usó/,
  );
  assert.equal(
    (await repo.redeem("demo-reset", "12345678", "reset")).role,
    "advisor",
  );
  await assert.rejects(
    repo.redeem("demo-reset", "12345678", "reset"),
    /ya se usó/,
  );
});
test("storage errors do not report successful login or logout", async () => {
  const bad: StoragePort = {
    async get() {
      throw new Error("storage");
    },
    async set() {
      throw new Error("storage");
    },
    async remove() {
      throw new Error("storage");
    },
  };
  const repo = new DemoAuthRepository(bad);
  await assert.rejects(repo.restore(), /storage/);
  await assert.rejects(repo.signIn("fer@ejemplo.mx", DEMO_PASSWORD), /storage/);
  await assert.rejects(repo.signOut(), /storage/);
});
test("Android Back closes layer before stack, then inbox, then requires double press", () => {
  assert.equal(resolveBack(true, true, false, null, 1000), "close-layer");
  assert.equal(resolveBack(false, true, false, null, 1000), "pop");
  assert.equal(resolveBack(false, false, false, null, 1000), "inbox");
  assert.equal(resolveBack(false, false, true, null, 1000), "arm-exit");
  assert.equal(resolveBack(false, false, true, 1000, 2500), "exit");
  assert.equal(resolveBack(false, false, true, 1000, 3000), "arm-exit");
});

test("simultaneous redemption cannot create two sessions and a failed save rolls back consumption", async () => {
  const s = storage();
  const repo = new DemoAuthRepository(s);
  const results = await Promise.allSettled([
    repo.redeem("demo-reset", "12345678", "reset"),
    repo.redeem("demo-reset", "12345678", "reset"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const base = storage();
  const failing: StoragePort = {
    ...base,
    async set(key, value) {
      if (key === "dashfort.demo.session.v1") throw new Error("save failed");
      await base.set(key, value);
    },
  };
  await assert.rejects(
    new DemoAuthRepository(failing).redeem(
      "demo-activate",
      "12345678",
      "activate",
    ),
    /save failed/,
  );
  assert.equal(base.values.size, 0);
});
