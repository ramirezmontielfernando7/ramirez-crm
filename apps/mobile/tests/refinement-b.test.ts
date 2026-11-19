import assert from "node:assert/strict";
import { test } from "node:test";
import { profiles } from "../labs/visual-refinement/profiles";
import { refinementB } from "../src/theme/refinement-b";
import { light, dark, typography } from "../src/theme/tokens";

test("production refinement stays identical to the original approved B, excluding its lab label", () => {
  const { label: _label, ...approved } = profiles.B;
  assert.deepEqual(refinementB, approved);
});
test("B preserves global palette and body/chat typography instead of changing shared defaults", () => {
  assert.equal(light.accentInk, "#0b6a6d");
  assert.equal(dark.accentInk, "#63bcbe");
  assert.deepEqual(typography.module, [26, 32]);
  assert.deepEqual(typography.body, [15, 21]);
  assert.deepEqual(typography.secondary, [14, 20]);
});
