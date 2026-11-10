import React, { createContext, useContext, useEffect, useState } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";
import { dark, light, type Colors, type ThemeMode } from "./tokens";
import { preferencesStorage } from "../services/storage";
const Context = createContext<{
  colors: Colors;
  dark: boolean;
  mode: ThemeMode;
  reducedMotion: boolean;
  setMode: (mode: ThemeMode) => Promise<void>;
  error: string;
}>({
  colors: light,
  dark: false,
  mode: "light",
  reducedMotion: true,
  setMode: async () => {},
  error: "",
});
export function ThemeProvider({ children }: React.PropsWithChildren) {
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
    setModeState(value);
    try {
      await preferencesStorage.set("dashfort.demo.theme", value);
      setError("");
    } catch {
      setError("El tema cambió, pero no se pudo guardar.");
    }
  };
  const isDark = mode === "dark" || (mode === "system" && system === "dark");
  return (
    <Context.Provider
      value={{
        colors: isDark ? dark : light,
        dark: isDark,
        mode,
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
