import React from "react";
import { Pressable, View } from "react-native";
import { Text } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { refinementB } from "../../theme/refinement-b";
export type CrmSection = "pipeline" | "contacts" | "library";
export function SectionTabs({
  value,
  onChange,
}: {
  value: CrmSection;
  onChange: (s: CrmSection) => void;
}) {
  const { colors: c } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        marginHorizontal: 16,
        marginTop: 6,
        marginBottom: 4,
        padding: 4,
        borderRadius: 24,
        flexDirection: "row",
        backgroundColor: c.sunken,
      }}
    >
      {(
        [
          ["pipeline", "Pipeline"],
          ["contacts", "Contactos"],
          ["library", "Biblioteca"],
        ] as const
      ).map(([key, label]) => (
        <Pressable
          key={key}
          accessibilityRole="tab"
          accessibilityLabel={label}
          accessibilityState={{ selected: value === key }}
          onPress={() => onChange(key)}
          hitSlop={4}
          style={{
            flex: 1,
            minHeight: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: value === key ? c.surface : "transparent",
          }}
        >
          <Text
            kind="secondary"
            weight="medium"
            style={{
              fontSize: refinementB.secondarySize,
              color: value === key ? c.accentInk : c.text2,
            }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
