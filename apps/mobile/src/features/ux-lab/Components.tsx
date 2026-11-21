import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, View } from "react-native";
import {
  Inbox,
  PanelsTopLeft,
  Sparkles,
  Megaphone,
  Menu,
  type LucideIcon,
} from "lucide-react-native";
import { Text } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { premium as p, premiumColors, segmentFrame } from "./tokens";
/** Fully reproducible RN control with equal cells and no selected-label remeasurement. Proposal only. */
export function PremiumSegments({
  options,
  value,
  onChange,
  width,
}: {
  options: readonly { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  width: number;
}) {
  const { dark, reducedMotion } = useTheme(),
    c = premiumColors(dark),
    index = Math.max(
      0,
      options.findIndex((o) => o.key === value),
    ),
    frame = segmentFrame(width, options.length, index),
    x = useRef(new Animated.Value(frame.x)).current;
  useEffect(() => {
    if (reducedMotion) {
      x.setValue(frame.x);
      return;
    }
    const a = Animated.timing(x, {
      toValue: frame.x,
      duration: p.motion,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    });
    a.start();
    return () => a.stop();
  }, [frame.x, x, reducedMotion]);
  return (
    <View
      testID="premium-segments"
      accessibilityRole="tablist"
      style={{
        width,
        height: p.segmentHeight,
        borderRadius: p.segmentRadius,
        backgroundColor: c.track,
        padding: p.segmentInset,
        flexDirection: "row",
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: frame.y,
          left: 0,
          width: frame.width,
          height: frame.height,
          borderRadius: p.segmentRadius - p.segmentInset,
          backgroundColor: c.surface,
          transform: [{ translateX: x }],
          boxShadow: dark ? undefined : "0px 1px 3px rgba(16,24,40,0.10)",
        }}
      />
      {options.map((o) => (
        <Pressable
          key={o.key}
          accessibilityRole="tab"
          accessibilityLabel={o.label}
          accessibilityState={{ selected: o.key === value }}
          aria-selected={o.key === value}
          onPress={() => onChange(o.key)}
          style={{
            width: frame.width,
            height: frame.height,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: p.segmentRadius - p.segmentInset,
          }}
        >
          <Text
            numberOfLines={1}
            weight="semibold"
            style={{
              fontSize: 13.5,
              lineHeight: 20,
              color: o.key === value ? c.accent : c.secondary,
            }}
          >
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function PremiumPill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const { dark } = useTheme(),
    c = premiumColors(dark);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      aria-pressed={!!selected}
      onPress={onPress}
      style={{ height: p.chipHit, justifyContent: "center" }}
    >
      <View
        style={{
          height: p.chipHeight,
          borderRadius: p.chipRadius,
          paddingHorizontal: 12,
          justifyContent: "center",
          backgroundColor: selected ? c.wash : c.surface,
          borderWidth: 1,
          borderColor: selected ? c.wash : c.line,
        }}
      >
        <Text
          kind="capsule"
          weight="medium"
          numberOfLines={1}
          style={{ color: selected ? c.accent : c.secondary }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
export const dockItems: readonly {
  key: string;
  label: string;
  icon: LucideIcon;
}[] = [
  { key: "inbox", label: "Bandeja", icon: Inbox },
  { key: "crm", label: "CRM", icon: PanelsTopLeft },
  { key: "studio", label: "Estudio IA", icon: Sparkles },
  { key: "marketing", label: "Marketing", icon: Megaphone },
  { key: "more", label: "Más", icon: Menu },
];
export function PremiumDock({
  value,
  onChange,
  bottom = 0,
}: {
  value: string;
  onChange: (key: string) => void;
  bottom?: number;
}) {
  const { dark } = useTheme(),
    c = premiumColors(dark);
  return (
    <View
      testID="premium-dock"
      accessibilityRole="tablist"
      accessibilityLabel="Navegación propuesta"
      style={{
        position: "absolute",
        bottom: bottom + p.dockBottom,
        left: p.dockInset,
        right: p.dockInset,
        height: p.dockHeight,
        borderRadius: p.dockRadius,
        padding: 8,
        flexDirection: "row",
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.line,
        boxShadow: dark
          ? "0px 6px 20px rgba(0,0,0,.30)"
          : "0px 6px 24px rgba(16,24,40,.10)",
      }}
    >
      {dockItems.map(({ key, label, icon: Icon }) => (
        <Pressable
          key={key}
          accessibilityRole="tab"
          accessibilityLabel={label}
          accessibilityState={{ selected: value === key }}
          aria-selected={value === key}
          onPress={() => onChange(key)}
          style={{
            flex: 1,
            minHeight: 48,
            borderRadius: 24,
            justifyContent: "center",
            alignItems: "center",
            gap: 3,
            backgroundColor: value === key ? c.wash : "transparent",
          }}
        >
          <Icon
            size={22}
            strokeWidth={1.8}
            color={value === key ? c.accent : c.secondary}
          />
          <Text
            kind="meta"
            numberOfLines={1}
            style={{
              fontSize: 10.5,
              lineHeight: 14,
              color: value === key ? c.accent : c.secondary,
            }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
