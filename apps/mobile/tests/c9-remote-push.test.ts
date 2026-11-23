import assert from "node:assert/strict";
import { test } from "node:test";
import { allowsRemoteRequest } from "../src/integration/remote-http";
import {
  conversationFromPush,
  isPushToken,
  PushRegistration,
  pushRoutes,
  type PushPort,
} from "../src/integration/remote-push";

const first = "fixture-first-fcm-device";
const second = "fixture-second-fcm-device";

test("C9 only adds exact POST paths to readonly and write-enabled builds", () => {
  for (const path of Object.values(pushRoutes)) {
    for (const write of [true, false]) {
      assert.equal(allowsRemoteRequest("POST", path, write), true);
      for (const method of ["GET", "PUT", "PATCH", "DELETE"])
        assert.equal(allowsRemoteRequest(method, path, write), false);
      for (const suffix of ["/", "?x=1", "#test", "\n", "/.."])
        assert.equal(allowsRemoteRequest("POST", path + suffix, write), false);
    }
  }
  assert.equal(allowsRemoteRequest("POST", "/api/mobile/push", true), false);
  assert.equal(isPushToken(first), true);
  assert.equal(isPushToken(first + "\n"), false);
  assert.equal(isPushToken("x".repeat(4097)), false);
});

test("C9 only parses scoped conversation IDs from the expected event", () => {
  assert.equal(
    conversationFromPush({ type: "message.new", conversationId: "conv_1" }),
    "conv_1",
  );
  for (const conversationId of ["https://fixture.test", "../conv_1", "", {}, 1])
    assert.equal(
      conversationFromPush({ type: "message.new", conversationId }),
      null,
    );
  assert.equal(
    conversationFromPush({ type: "open.url", conversationId: "conv_1" }),
    null,
  );
});

test("C9 serializes opt-in, duplicate sync, renewal, and logout cleanup", async () => {
  const operations: [string, boolean][] = [];
  const permissions: boolean[] = [];
  let reads = 0;
  let allowed = false;
  let time = 0;
  const native: PushPort = {
    available: true,
    async permission(request) {
      permissions.push(request);
      return allowed;
    },
    async token() {
      reads++;
      return first;
    },
    onToken: () => () => {},
    onTap: () => () => {},
    async resetTaps() {},
  };
  const push = new PushRegistration(
    native,
    async (...args) => {
      operations.push(args);
    },
    () => time,
  );
  assert.equal(await push.sync(true), false);
  assert.deepEqual(permissions, [true]);
  assert.equal(reads, 0);
  assert.deepEqual(operations, []);
  allowed = true;
  await Promise.all([push.sync(true), push.sync(false), push.sync(false)]);
  assert.equal(reads, 1);
  assert.deepEqual(operations, [[first, true]]);
  time += 86_400_000;
  await push.sync(false, second);
  assert.deepEqual(operations, [
    [first, true],
    [second, true],
    [first, false],
  ]);
  await push.disable(false);
  await push.disable(false);
  assert.deepEqual(operations.at(-1), [second, false]);
  assert.equal(operations.length, 4);
});

test("C9 retries unlink on reconnection without persisting the device token", async () => {
  let linked = true;
  let unavailable = true;
  const native: PushPort = {
    available: true,
    async permission() {
      return true;
    },
    async token() {
      return first;
    },
    onToken: () => () => {},
    onTap: () => () => {},
    async resetTaps() {},
  };
  const unregister = async (token: string, register: boolean) => {
    assert.equal(token, first);
    assert.equal(register, false);
    if (unavailable) throw new Error("sin red");
    linked = false;
  };
  await assert.rejects(
    new PushRegistration(native, unregister).disable(true),
    /sin red/,
  );
  assert.equal(linked, true);
  unavailable = false;
  await new PushRegistration(native, unregister).disable(true);
  assert.equal(linked, false);
});
