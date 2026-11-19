import React from "react";
import { View } from "react-native";
import { TagCapsule, Text } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { useOptionalInbox } from "../inbox/store";
import { tagColors } from "./palette";
export function CatalogTag({
  name,
  color: preview,
}: {
  name: string;
  color?: string;
}) {
  const inbox = useOptionalInbox(),
    { colors: c, dark } = useTheme(),
    color = preview ?? inbox?.repository.catalog.tag(name)?.color;
  if (!color || color === "#4338ca") return <TagCapsule>{name}</TagCapsule>;
  const tone = tagColors(color, dark, c.surface);
  return (
    <View
      style={{
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: 10,
        backgroundColor: tone.background,
        alignSelf: "flex-start",
      }}
    >
      <Text kind="capsule" weight="medium" style={{ color: tone.foreground }}>
        {name}
      </Text>
    </View>
  );
}
