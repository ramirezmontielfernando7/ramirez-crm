import assert from "node:assert/strict";
import { test } from "node:test";
import { dark, light } from "../src/theme/tokens";
function luminance(hex: string) {
  const values = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
}
function contrast(fg: string, bg: string) {
  const a = luminance(fg),
    b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
for (const [name, c] of Object.entries({ light, dark })) {
  test(`WCAG AA text, buttons, capsules and message metadata in ${name}`, () => {
    const pairs = [
      [c.text, c.surface],
      [c.text2, c.surface],
      [c.text3, c.surface],
      [c.accentInk, c.surface],
      [c.accentInk, c.wash],
      [c.onAccent, c.accent],
      ["#ffffff", c.dangerFill],
      [c.tagText, c.tagBg],
      ...[c.bubbleIn, c.bubbleTeam, c.bubbleAi, c.bubbleConnected].flatMap(
        (bg) => [
          [c.text, bg],
          [c.text2, bg],
        ],
      ),
    ];
    for (const [fg, bg] of pairs)
      assert.ok(
        contrast(fg!, bg!) >= 4.5,
        `${fg} on ${bg}: ${contrast(fg!, bg!).toFixed(2)}`,
      );
  });
}
