import { test } from "node:test";
import assert from "node:assert/strict";
import {
  segmentFrame,
  premium,
  dockReserve,
} from "../src/features/ux-lab/tokens";
test("Premium segmented cells keep the same size for Clients, Team and My number", () => {
  for (const width of [328, 358]) {
    const a = segmentFrame(width, 3, 0),
      b = segmentFrame(width, 3, 1),
      c = segmentFrame(width, 3, 2);
    assert.equal(a.width, b.width);
    assert.equal(b.width, c.width);
    assert.equal(a.height, 48);
    assert.equal(c.x + c.width + premium.segmentInset, width);
  }
});
test("Premium dock reserves its complete height, inset and clearance for content", () => {
  assert.equal(dockReserve(0), 96);
  assert.equal(dockReserve(34), 130);
  assert.equal(dockReserve(-10), 96);
});
test("Invalid segment geometry cannot create NaN or off-screen cells", () => {
  for (const [w, n, i] of [
    [NaN, 3, 0],
    [300, 0, 0],
    [300, 3, 3],
    [-1, 3, 0],
  ])
    assert.throws(() => segmentFrame(w!, n!, i!));
});
