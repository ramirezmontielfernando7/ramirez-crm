import React from "react";
import { View } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { IconButton } from "../../components/ModuleUi";
import { Text } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
/** Approved internal bar with subtitle; module B headers still use ModuleUi. */
export function StudioBar({
  title,
  subtitle,
  onBack,
  actions,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  actions?: React.ReactNode;
}) {
  const { colors: c } = useTheme();
  return (
    <View
      style={{
        minHeight: 56,
        paddingHorizontal: 4,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      }}
    >
      <IconButton icon={ArrowLeft} label="Atrás" onPress={onBack} />
      <View style={{ flex: 1, gap: 0 }}>
        <Text
          accessibilityRole="header"
          kind="title"
          weight="semibold"
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle && (
          <Text kind="meta" numberOfLines={1} style={{ color: c.text3 }}>
            {subtitle}
          </Text>
        )}
      </View>
      {actions}
    </View>
  );
}
