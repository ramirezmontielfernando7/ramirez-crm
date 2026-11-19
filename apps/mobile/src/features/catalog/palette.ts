import { tagPalette } from "./core";
const rgb = (s: string) =>
  [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) =>
  "#" +
  rgb(a)
    .map((v, i) =>
      Math.round(v * (1 - t) + rgb(b)[i]! * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
function luminance(s: string) {
  const a = rgb(s).map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return a[0]! * 0.2126 + a[1]! * 0.7152 + a[2]! * 0.0722;
}
export function tagContrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function tagColors(color: string, dark: boolean, surface: string) {
  if (!(tagPalette as readonly string[]).includes(color))
    throw Error("Color no válido.");
  const background = mix(surface, color, dark ? 0.22 : 0.12);
  let foreground = color;
  for (let n = 0; n < 20 && tagContrast(foreground, background) < 4.5; n++)
    foreground = mix(foreground, dark ? "#ffffff" : "#000000", 0.15);
  return { background, foreground };
}
