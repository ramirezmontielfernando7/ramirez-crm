import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  validateEnvironment,
  verifyIdentity,
  migrationPlan,
} from "../../auth-only/policy.mjs";
import { createAuthOnlyHandler } from "../../auth-only/handler.mjs";
const env = () => ({
  NODE_ENV: "test",
  DASHFORT_PROFILE: "isolated-auth-v1",
  DASHFORT_TEST_INSTANCE: "fixture-instance-123456789012",
  APP_BASE_URL: "http://127.0.0.1:3137",
  DATABASE_URL:
    "postgresql://vocero_app:fixture-password-app@db.i2p.invalid:5432/dashfort_auth_test",
  DATABASE_URL_SYSTEM:
    "postgresql://vocero_system:fixture-password-system@db.i2p.invalid:5432/dashfort_auth_test",
  BETTER_AUTH_SECRET: "fixture-auth-secret-12345678901234567890",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "fixture-unused-not-connected",
  DB_POOL_MAX: "2",
  DB_SYSTEM_POOL_MAX: "2",
});
const identities = () => [
  {
    database: "dashfort_auth_test",
    user: "vocero_app",
    instance: "fixture-instance-123456789012",
    superuser: false,
    bypassRls: false,
    version: 180000,
  },
  {
    database: "dashfort_auth_test",
    user: "vocero_system",
    instance: "fixture-instance-123456789012",
    superuser: false,
    bypassRls: true,
    version: 180000,
  },
];
test("strict test plan is never operational permission", () => {
  assert.equal(validateEnvironment(env()).readyToStart, false);
});
test("every missing mandatory key is rejected", () => {
  for (const k of Object.keys(env())) {
    const e = env();
    delete e[k];
    assert.throws(() => validateEnvironment(e), k);
  }
});
test("providers, migration credentials, preload and inherited unknown variables reject", () => {
  for (const k of [
    "DATABASE_URL_MIGRATE",
    "META_APP_SECRET",
    "BOT_API_KEY",
    "OPENROUTER_API_TOKEN",
    "NODE_OPTIONS",
    "HOME",
    "WA_MOCK_ENABLED",
  ])
    assert.throws(() =>
      validateEnvironment({ ...env(), [k]: "fixture-value" }),
    );
});
test("each DSN rejects production, alternate host, role, query and secretless URL", () => {
  for (const key of ["DATABASE_URL", "DATABASE_URL_SYSTEM"])
    for (const v of [
      "postgresql://postgres:fixture-password-123@db.i2p.invalid:5432/dashfort_auth_test",
      env()[key].replace("db.i2p.invalid", "127.0.0.1"),
      env()[key].replace("/dashfort_auth_test", "/dashfort"),
      env()[key] + "?options=-csearch_path%3Dpublic",
    ])
      assert.throws(() => validateEnvironment({ ...env(), [key]: v }));
});
test("both identities and privilege profiles are mandatory, DB failure cannot warn-and-continue", () => {
  const p = validateEnvironment(env());
  verifyIdentity(p, ...identities());
  for (const i of [0, 1])
    for (const field of [
      "database",
      "user",
      "instance",
      "superuser",
      "bypassRls",
      "version",
    ]) {
      const r = identities();
      r[i][field] =
        field === "version"
          ? 160000
          : field === "superuser"
            ? true
            : field === "bypassRls"
              ? !r[i][field]
              : "wrong";
      assert.throws(() => verifyIdentity(p, ...r));
    }
  assert.throws(() => verifyIdentity(p, null, null));
});
test("migration plan stays separate, inactive and compatible with original SQL roles", () => {
  assert.equal(
    migrationPlan({
      profile: "isolated-auth-v1",
      host: "db.i2p.invalid",
      database: "dashfort_auth_test",
      role: "i2p_migrate",
      applicationRole: "vocero_app",
      systemRole: "vocero_system",
    }).readyToExecute,
    false,
  );
  assert.throws(() => migrationPlan({}));
});
test("denied routes/method/origin never import auth or touch a database", async () => {
  let calls = 0;
  const h = createAuthOnlyHandler(env(), {
    identities() {
      calls++;
      return identities();
    },
    loadAuth() {
      calls++;
      return { handler: () => new Response("ok") };
    },
  });
  for (const path of [
    "/api/webhooks/whatsapp",
    "/api/conversations",
    "/api/auth/sign-up/email",
    "/api/auth/organization/create",
    "/api/auth/get-session?token=x",
  ])
    assert.equal((await h(new Request(env().APP_BASE_URL + path))).status, 404);
  assert.equal(
    (
      await h(
        new Request(env().APP_BASE_URL + "/api/auth/sign-out", {
          method: "POST",
          headers: {
            Origin: "https://evil.invalid",
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
});
test("handler reuses adapter response cookies and preserves status without exposing errors", async () => {
  let calls = 0;
  const h = createAuthOnlyHandler(env(), {
    identities: async () => identities(),
    loadAuth: async () => ({
      handler: async () => {
        calls++;
        const headers = new Headers();
        headers.append("Set-Cookie", "fixture-a=1; HttpOnly");
        headers.append("Set-Cookie", "fixture-b=2; HttpOnly");
        return new Response("{}", { status: 200, headers });
      },
    }),
  });
  const r = await h(new Request(env().APP_BASE_URL + "/api/auth/get-session"));
  assert.equal(calls, 1);
  assert.equal(r.headers.getSetCookie().length, 2);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
});
test("unverified DB or connection errors prevent importing Better Auth", async () => {
  let calls = 0;
  const h = createAuthOnlyHandler(env(), {
    identities: async () => {
      throw Error("private DSN");
    },
    loadAuth: async () => {
      calls++;
    },
  });
  const r = await h(new Request(env().APP_BASE_URL + "/api/auth/get-session"));
  assert.equal(r.status, 503);
  assert.equal(calls, 0);
  assert.ok(!(await r.text()).includes("private"));
});
test("oversize request is rejected before DB", async () => {
  const h = createAuthOnlyHandler(env(), {
    identities: () => {
      throw Error("must not run");
    },
    loadAuth: () => {
      throw Error("must not run");
    },
  });
  assert.equal(
    (
      await h(
        new Request(env().APP_BASE_URL + "/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            Origin: env().APP_BASE_URL,
            "Content-Type": "application/json",
          },
          body: "x".repeat(8193),
        }),
      )
    ).status,
    413,
  );
});
test("no worker, Next instrumentation, migration execution, timer or network listener in preparation modules", () => {
  for (const name of ["policy.mjs", "handler.mjs", "existing-auth.ts"]) {
    const text = readFileSync(
      new URL("../../auth-only/" + name, import.meta.url),
      "utf8",
    );
    for (const marker of [
      ".listen(",
      "setInterval(",
      "startCampaign",
      "instrumentation",
      "migrate.mjs",
      "createServer(",
      "node:child_process",
    ])
      assert.ok(!text.includes(marker), name + ": " + marker);
  }
});
test("web TS ESLint and Docker exclude mobile and isolated auth preparation", () => {
  const root = new URL("../../", import.meta.url);
  const ts = JSON.parse(readFileSync(new URL("tsconfig.json", root), "utf8"));
  for (const path of ["apps/mobile", "auth-only"])
    assert.ok(ts.exclude.includes(path));
  const lint = readFileSync(new URL("eslint.config.mjs", root), "utf8"),
    docker = readFileSync(new URL(".dockerignore", root), "utf8");
  for (const path of ["apps/mobile", "auth-only"]) {
    assert.ok(lint.includes('"' + path + '/**"'));
    assert.ok(docker.split("\n").includes(path));
  }
});
test("Node preparation exports a factory without listening or invoking it", () => {
  const text = readFileSync(
    new URL("../../auth-only/prepare-node.ts", import.meta.url),
    "utf8",
  );
  assert.ok(text.includes("export async function prepareNodeServer"));
  assert.match(text, /import\(["']better-auth\/node["']\)/);
  assert.ok(!/\.listen\s*\(/.test(text));
  assert.ok(!text.includes("prepareNodeServer();"));
});
