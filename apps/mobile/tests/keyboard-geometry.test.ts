import { test } from "node:test";
import assert from "node:assert/strict";
import {
  keyboardOverlap,
  revealScrollDelta,
  type Rect,
} from "../src/features/keyboard/geometry";
const screen: Rect = { x: 0, y: 24, width: 390, height: 796 },
  ime: Rect = { x: 0, y: 540, width: 390, height: 304 };
test("Edge-to-edge Android measures IME in screen space including safe-area origin", () =>
  assert.equal(keyboardOverlap(screen, ime), 280));
test("Android adjustResize already above IME produces zero additional reduction", () =>
  assert.equal(keyboardOverlap({ ...screen, height: 516 }, ime), 0));
test("Modal window uses its own measured origin, never the screen's old height", () =>
  assert.equal(
    keyboardOverlap({ x: 20, y: 80, width: 350, height: 720 }, ime),
    260,
  ));
test("Hidden or hardware keyboard adds no padding", () => {
  assert.equal(keyboardOverlap(screen, null), 0);
  assert.equal(keyboardOverlap(screen, { ...ime, height: 0 }), 0);
});
test("Changing IME height recalculates overlap without accumulating old padding", () => {
  assert.equal(keyboardOverlap(screen, { ...ime, y: 400 }), 420);
  assert.equal(keyboardOverlap(screen, ime), 280);
  assert.equal(keyboardOverlap(screen, null), 0);
});
test("Landscape and already-visible inputs preserve non-overlapping viewport", () =>
  assert.equal(
    keyboardOverlap(
      { x: 0, y: 24, width: 844, height: 240 },
      { x: 0, y: 264, width: 844, height: 126 },
    ),
    0,
  ));
test("Floating keyboard must not collapse the entire viewport", () =>
  assert.equal(
    keyboardOverlap(screen, { x: 180, y: 420, width: 180, height: 200 }),
    0,
  ));
test("iOS cross-fade zero position must not collapse the entire viewport", () =>
  assert.equal(keyboardOverlap(screen, { ...ime, y: 0 }), 0));
test("Invalid geometry and disjoint windows are ignored", () => {
  assert.equal(keyboardOverlap({ ...screen, height: NaN }, ime), 0);
  assert.equal(keyboardOverlap(screen, { ...ime, x: 900 }), 0);
  assert.equal(keyboardOverlap({ ...screen, width: 0 }, ime), 0);
});

test("Already-visible focused inputs keep their exact scroll position", () =>
  assert.equal(
    revealScrollDelta(
      { x: 16, y: 240, width: 300, height: 48 },
      { x: 0, y: 80, width: 390, height: 460 },
      ime,
    ),
    0,
  ));
test("Only the hidden portion of a field is scrolled above IME", () =>
  assert.equal(
    revealScrollDelta(
      { x: 16, y: 510, width: 300, height: 48 },
      { x: 0, y: 80, width: 390, height: 460 },
      ime,
    ),
    30,
  ));
test("Moving focus above the current viewport reveals only the missing top", () =>
  assert.equal(
    revealScrollDelta(
      { x: 16, y: 70, width: 300, height: 48 },
      { x: 0, y: 80, width: 390, height: 460 },
      ime,
    ),
    -22,
  ));
test("Floating IME only affects horizontally intersecting fields", () => {
  const k = { x: 220, y: 300, width: 160, height: 200 };
  assert.equal(
    revealScrollDelta({ x: 16, y: 320, width: 100, height: 48 }, screen, k),
    0,
  );
  assert.equal(
    revealScrollDelta({ x: 230, y: 320, width: 100, height: 48 }, screen, k),
    80,
  );
});
