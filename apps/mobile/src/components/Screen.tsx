import React from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
export function Screen({
  children,
  keyboard = false,
  backgroundColor,
}: React.PropsWithChildren<{ keyboard?: boolean; backgroundColor?: string }>) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      edges={["top", "left", "right", "bottom"]}
      style={{ flex: 1, backgroundColor: backgroundColor ?? colors.surface }}
    >
      <KeyboardAvoidingView
        enabled={keyboard && Platform.OS === "ios"}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1 }}>{children}</View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
