import React from "react";
import { View, Pressable } from "react-native";
import { router } from "expo-router";
import { Text } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
export function MarketingTabs({
  value,
}: {
  value: "campaigns" | "audiences" | "templates" | "metrics";
}) {
  const { colors: c } = useTheme();
  return (
    <View style={{ flexDirection: "row", paddingHorizontal: 8 }}>
      {(
        [
          ["campaigns", "Campañas"],
          ["audiences", "Audiencias"],
          ["templates", "Plantillas"],
          ["metrics", "Métricas"],
        ] as const
      ).map(([key, label]) => (
        <Pressable
          key={key}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === key }}
          onPress={() => router.replace(`/(tabs)/marketing?section=${key}`)}
          style={{
            minHeight: 48,
            justifyContent: "center",
            paddingHorizontal: 8,
            borderBottomWidth: value === key ? 2 : 0,
            borderColor: c.accent,
          }}
        >
          <Text
            kind="secondary"
            style={{ color: value === key ? c.accentInk : c.text3 }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
