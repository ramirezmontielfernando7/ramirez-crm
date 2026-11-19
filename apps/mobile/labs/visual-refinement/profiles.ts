/** Lab-only values. Nothing in app/ or src/ imports these profiles. */
export type Variant = "actual" | "A" | "B" | "C";
export const profiles = {
  actual: {
    label: "Actual",
    titleSize: 26,
    titleLine: 32,
    titleWeight: "semibold",
    iconSize: 22,
    iconStroke: 1.8,
    headerHeight: 52,
    trackRadius: 12,
    trackPadding: 4,
    itemRadius: 10,
    itemHeight: 48,
    labelSize: 14,
    chipHeight: 36,
    chipPadding: 14,
    chipGap: 8,
    chipSize: 12.5,
    nameSize: 16,
    secondarySize: 14,
  },
  A: {
    label: "A · Refinamiento mínimo",
    titleSize: 25,
    titleLine: 32,
    titleWeight: "semibold",
    iconSize: 21,
    iconStroke: 1.8,
    headerHeight: 52,
    trackRadius: 16,
    trackPadding: 4,
    itemRadius: 12,
    itemHeight: 48,
    labelSize: 14,
    chipHeight: 35,
    chipPadding: 14,
    chipGap: 8,
    chipSize: 12.5,
    nameSize: 16,
    secondarySize: 14,
  },
  B: {
    label: "B · Moderna y compacta",
    titleSize: 24,
    titleLine: 30,
    titleWeight: "medium",
    iconSize: 21,
    iconStroke: 1.8,
    headerHeight: 52,
    trackRadius: 26,
    trackPadding: 2,
    itemRadius: 24,
    itemHeight: 48,
    labelSize: 13.5,
    chipHeight: 32,
    chipPadding: 12,
    chipGap: 6,
    chipSize: 12.5,
    nameSize: 15.5,
    secondarySize: 13.5,
  },
  C: {
    label: "C · Identidad refinada",
    titleSize: 25,
    titleLine: 32,
    titleWeight: "semibold",
    iconSize: 22,
    iconStroke: 1.9,
    headerHeight: 52,
    trackRadius: 20,
    trackPadding: 3,
    itemRadius: 16,
    itemHeight: 48,
    labelSize: 14,
    chipHeight: 34,
    chipPadding: 14,
    chipGap: 8,
    chipSize: 12.5,
    nameSize: 16,
    secondarySize: 14,
  },
} as const;
let state: { variant: Variant; theme: "light" | "dark" } = {
  variant: "actual",
  theme: "light",
};
export const configure = (variant: Variant, theme: "light" | "dark") => {
  if (!(variant in profiles) || !["light", "dark"].includes(theme))
    throw Error("Invalid lab profile");
  state = { variant, theme };
};
export const labState = () => state;
export const profile = () => profiles[state.variant];
export const accent = (base: string) =>
  state.variant === "C"
    ? state.theme === "dark"
      ? "#78cfd0"
      : "#0a7074"
    : base;
export const wash = (base: string) =>
  state.variant === "C"
    ? state.theme === "dark"
      ? "#204957"
      : "#e1f1f1"
    : base;
