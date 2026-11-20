import {
  fontFamily as resolveFont,
  palette,
  type ThemeProfile,
} from "./personalized";
import React, { createContext, useContext, useEffect, useState } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";
import { light, type Colors, type ThemeMode } from "./tokens";
import { preferencesStorage } from "../services/storage";
const Context = createContext<{
  colors: Colors;
  fontFamily: (weight?: "regular" | "medium" | "semibold") => string;
  chatStyle: "classic" | "whatsapp";
  brandName: string;
  brandAsset: "original" | "sample";
  dark: boolean;
  mode: ThemeMode;
  reducedMotion: boolean;
  setMode: (mode: ThemeMode) => Promise<void>;
  error: string;
}>({
  colors: light,
  fontFamily: (weight) => resolveFont("Inter", weight),
  chatStyle: "classic",
  brandName: "Dashfort",
  brandAsset: "original",
  dark: false,
  mode: "light",
  reducedMotion: true,
  setMode: async () => {},
  error: "",
});
export function ThemeProvider({
  children,
  profile,
  onMode,
}: React.PropsWithChildren<{
  profile?: ThemeProfile;
  onMode?: (mode: ThemeMode) => Promise<void>;
}>) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [reducedMotion, setReducedMotion] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    void preferencesStorage
      .get("dashfort.demo.theme")
      .then((saved) => {
        if (saved === "light" || saved === "dark" || saved === "system")
          setModeState(saved);
      })
      .catch(() => setError("No se pudo recuperar tu tema."));
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReducedMotion)
      .catch(() => setReducedMotion(true));
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => sub.remove();
  }, []);
  const setMode = async (value: ThemeMode) => {
    if (onMode) return onMode(value);
    setModeState(value);
    try {
      await preferencesStorage.set("dashfort.demo.theme", value);
      setError("");
    } catch {
      setError("El tema cambió, pero no se pudo guardar.");
    }
  };
  const resolvedMode = profile?.theme ?? mode;
  const isDark =
    resolvedMode === "dark" || (resolvedMode === "system" && system === "dark");
  return (
    <Context.Provider
      value={{
        colors: palette(profile?.accent ?? "#0e7c80", isDark),
        fontFamily: (weight) => resolveFont(profile?.font ?? "Inter", weight),
        chatStyle: profile?.chat ?? "classic",
        brandName: profile?.name ?? "Dashfort",
        brandAsset: profile?.asset ?? "original",
        dark: isDark,
        mode: resolvedMode,
        reducedMotion,
        setMode,
        error,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useTheme = () => useContext(Context);
