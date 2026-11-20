import { dark, light, type Colors } from "./tokens";
import type { Appearance, Brand, Font } from "../features/personalization/core";
export type ThemeProfile = Appearance &
  Pick<Brand, "name" | "accent" | "asset">;
export function fontFamily(
  font: Font = "Inter",
  weight: "regular" | "medium" | "semibold" = "regular",
) {
  const w = weight === "regular" ? 400 : weight === "medium" ? 500 : 600;
  return font === "Inter"
    ? `Inter_${w}${w === 400 ? "Regular" : w === 500 ? "Medium" : "SemiBold"}`
    : `${font}_${w}`;
}
function mix(a: string, b: string, t: number) {
  return (
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(a.slice(i, i + 2), 16) * (1 - t) +
            parseInt(b.slice(i, i + 2), 16) * t,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
/** Neutral/semantic/AI tokens retain their meanings; every brand-dependent token is derived. */
export function palette(accent: string, isDark: boolean): Colors {
  const base = isDark ? dark : light;
  if (accent === "#0e7c80") return base;
  return {
    ...base,
    brand: accent,
    accent: mix(accent, isDark ? "#ffffff" : "#000000", isDark ? 0.35 : 0.23),
    accentInk: mix(accent, isDark ? "#ffffff" : "#000000", isDark ? 0.6 : 0.25),
    onAccent: isDark ? "#071c25" : "#ffffff",
    wash: mix(accent, base.surface, 0.85),
    tint: mix(accent, base.surface, 0.92),
    bubbleTeam: mix(accent, base.surface, isDark ? 0.65 : 0.83),
  };
}
