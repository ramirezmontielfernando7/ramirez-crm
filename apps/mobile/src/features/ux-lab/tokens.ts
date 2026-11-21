/** CANCELED P1: historical lab only. Never import into the application. */
export const premium = {
  gutter: 16,
  header: 56,
  title: 26,
  segmentHeight: 56,
  segmentInset: 4,
  segmentRadius: 28,
  chipHeight: 32,
  chipHit: 48,
  chipRadius: 16,
  chipGap: 8,
  dockHeight: 72,
  dockRadius: 32,
  dockInset: 12,
  dockBottom: 8,
  cardRadius: 20,
  motion: 180,
} as const;
export function dockReserve(bottomInset: number) {
  return (
    premium.dockHeight + premium.dockBottom + Math.max(0, bottomInset) + 16
  );
}
export function segmentFrame(width: number, count: number, index: number) {
  if (
    !Number.isFinite(width) ||
    width < 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= count
  )
    throw Error("Invalid segment geometry");
  const item = Math.max(0, width - 2 * premium.segmentInset) / count;
  return {
    width: item,
    height: premium.segmentHeight - 2 * premium.segmentInset,
    x: premium.segmentInset + item * index,
    y: premium.segmentInset,
  };
}
export function premiumColors(dark: boolean) {
  return dark
    ? {
        base: "#10151e",
        surface: "#1b2330",
        track: "#253041",
        line: "#344052",
        text: "#edf1f8",
        secondary: "#afbbcf",
        accent: "#63bcbe",
        wash: "#1e414b",
      }
    : {
        base: "#f5f6f8",
        surface: "#ffffff",
        track: "#e9edf1",
        line: "#e0e5ea",
        text: "#1d1d1f",
        secondary: "#687384",
        accent: "#0b6a6d",
        wash: "#e3f3f3",
      };
}
