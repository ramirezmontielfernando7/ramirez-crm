import assert from "node:assert/strict";
import { test } from "node:test";
import {
  startOpening,
  openingDuration,
  openingKey,
} from "../src/features/opening/core";
function setup(seen: string | null = null) {
  let done = 0,
    visible = false,
    cleared = 0;
  const timers = new Map<unknown, () => void>(),
    data = new Map<string, string>();
  if (seen) data.set(openingKey, seen);
  const clock = {
    set: (fn: () => void, ms: number) => {
      assert.equal(ms, 800);
      timers.set(1, fn);
      return 1;
    },
    clear: (id: unknown) => {
      cleared++;
      timers.delete(id);
    },
  };
  const storage = {
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => {
      data.set(k, v);
    },
  };
  return {
    storage,
    clock,
    data,
    show: (v: boolean) => {
      visible = v;
    },
    done: () => {
      done++;
    },
    get finished() {
      return done;
    },
    get visible() {
      return visible;
    },
    get cleared() {
      return cleared;
    },
    tick: () => {
      for (const f of timers.values()) f();
    },
  };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
test("First presentation shows approved view then exits within the requested 800ms budget", async () => {
  const f = setup();
  startOpening(f.storage, false, f.show, f.done, f.clock);
  await settle();
  assert.equal(f.visible, true);
  assert.equal(f.finished, 0);
  f.tick();
  assert.equal(f.visible, false);
  assert.equal(f.finished, 1);
  assert.equal(f.data.get(openingKey), "seen");
  assert.ok(openingDuration < 1000);
});
test("Subsequent launches redirect without animation or timer delay", async () => {
  const f = setup("seen");
  startOpening(f.storage, false, f.show, f.done, f.clock);
  await settle();
  assert.equal(f.visible, false);
  assert.equal(f.finished, 1);
  f.tick();
  assert.equal(f.finished, 1);
});
test("Reduced motion skips visual presentation and records preference without waiting for write", async () => {
  const f = setup();
  f.storage.set = async () => new Promise(() => {});
  startOpening(f.storage, true, f.show, f.done, f.clock);
  await settle();
  assert.equal(f.visible, false);
  assert.equal(f.finished, 1);
});
test("Read failure never blocks access", async () => {
  const f = setup();
  f.storage.get = async () => {
    throw Error("disk");
  };
  startOpening(f.storage, false, f.show, f.done, f.clock);
  await settle();
  assert.equal(f.finished, 1);
  assert.equal(f.visible, false);
});
test("Unresolved read times out; late result cannot resurrect the view or write", async () => {
  const f = setup();
  let resolve!: (v: string | null) => void;
  f.storage.get = async () =>
    new Promise((r) => {
      resolve = r;
    });
  startOpening(f.storage, false, f.show, f.done, f.clock);
  f.tick();
  resolve(null);
  await settle();
  assert.equal(f.finished, 1);
  assert.equal(f.visible, false);
  assert.equal(f.data.size, 0);
});
test("Unmount cancels timers and ignores late read", async () => {
  const f = setup();
  let resolve!: (v: string | null) => void;
  f.storage.get = async () =>
    new Promise((r) => {
      resolve = r;
    });
  const cancel = startOpening(f.storage, false, f.show, f.done, f.clock);
  cancel();
  resolve(null);
  await settle();
  f.tick();
  assert.equal(f.finished, 0);
  assert.equal(f.visible, false);
  assert.equal(f.data.size, 0);
});
test("Write failure does not extend presentation or block redirection", async () => {
  const f = setup();
  f.storage.set = async () => {
    throw Error();
  };
  startOpening(f.storage, false, f.show, f.done, f.clock);
  await settle();
  assert.equal(f.visible, true);
  f.tick();
  assert.equal(f.finished, 1);
});
