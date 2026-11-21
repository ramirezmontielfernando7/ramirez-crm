import React from "react";
import { View } from "react-native";
import { KeyboardViewport } from "../features/keyboard/KeyboardViewport";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
export function Screen({
  children,
  keyboard = true,
  backgroundColor,
}: React.PropsWithChildren<{ keyboard?: boolean; backgroundColor?: string }>) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      edges={["top", "left", "right", "bottom"]}
      style={{ flex: 1, backgroundColor: backgroundColor ?? colors.surface }}
    >
      <KeyboardViewport enabled={keyboard}>
        <View style={{ flex: 1 }}>{children}</View>
      </KeyboardViewport>
    </SafeAreaView>
  );
}
