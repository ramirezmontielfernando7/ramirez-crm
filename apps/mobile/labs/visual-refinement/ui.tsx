import React from "react";
import { Pressable, ScrollView, View, StyleSheet } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import * as Base from "../../src/components/ui";
import { useTheme } from "../../src/theme/ThemeProvider";
import { accent, wash, profile, labState } from "./profiles";
export * from "../../src/components/ui";
export function Text(props: React.ComponentProps<typeof Base.Text>) {
  const { colors: c } = useTheme(),
    p = profile();
  if (labState().variant === "actual") return <Base.Text {...props} />;
  const old = StyleSheet.flatten(props.style),
    kind = props.kind ?? "body";
  const muted =
    labState().variant === "C" &&
    kind === "secondary" &&
    old?.color === c.text3;
  return (
    <Base.Text
      {...props}
      style={[
        props.style,
        kind === "name"
          ? { fontSize: p.nameSize }
          : kind === "secondary"
            ? { fontSize: p.secondarySize }
            : null,
        muted
          ? { color: labState().theme === "dark" ? "#aebdd7" : "#5d6268" }
          : null,
      ]}
    />
  );
}
export function IconButton(
  props: React.ComponentProps<typeof Base.IconButton>,
) {
  const { colors: c } = useTheme();
  const p = profile();
  if (labState().variant === "actual") return <Base.IconButton {...props} />;
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        alignItems: "center",
        justifyContent: "center",
        opacity: props.disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Icon
        size={p.iconSize}
        strokeWidth={p.iconStroke}
        color={accent(c.accentInk)}
      />
    </Pressable>
  );
}
export function AppBar(props: React.ComponentProps<typeof Base.AppBar>) {
  const { colors: c } = useTheme();
  const p = profile();
  if (labState().variant === "actual") return <Base.AppBar {...props} />;
  return (
    <View
      style={{
        minHeight: p.headerHeight,
        paddingHorizontal: props.onBack ? 4 : 16,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      {props.onBack && (
        <IconButton icon={ArrowLeft} label="Atrás" onPress={props.onBack} />
      )}
      <Base.Text
        accessibilityRole="header"
        kind={props.module ? "module" : "title"}
        weight={props.module ? p.titleWeight : "semibold"}
        style={{
          flex: 1,
          paddingVertical: 8,
          fontSize: props.module ? p.titleSize : 17,
          lineHeight: props.module ? p.titleLine : 22,
          color: props.module ? accent(c.accentInk) : c.text,
        }}
      >
        {props.title}
      </Base.Text>
      {props.actions}
    </View>
  );
}
export function SegmentedControl(
  props: React.ComponentProps<typeof Base.SegmentedControl>,
) {
  const { colors: c } = useTheme(),
    p = profile();
  if (labState().variant === "actual")
    return <Base.SegmentedControl {...props} />;
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        backgroundColor: c.base,
        borderRadius: p.trackRadius,
        padding: p.trackPadding,
      }}
    >
      {props.options.map((o) => (
        <Pressable
          key={o.key}
          accessibilityRole="tab"
          accessibilityLabel={o.label}
          accessibilityState={{ selected: o.key === props.value }}
          aria-selected={o.key === props.value}
          onPress={() => props.onChange(o.key)}
          style={{
            flex: 1,
            minHeight: p.itemHeight,
            borderRadius: p.itemRadius,
            paddingHorizontal: 4,
            paddingVertical: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: o.key === props.value ? c.surface : "transparent",
          }}
        >
          <Base.Text
            kind="secondary"
            weight={
              labState().variant === "C" && o.key === props.value
                ? "semibold"
                : "medium"
            }
            style={{
              fontSize: p.labelSize,
              textAlign: "center",
              color: o.key === props.value ? accent(c.accentInk) : c.text3,
            }}
          >
            {o.label}
          </Base.Text>
        </Pressable>
      ))}
    </View>
  );
}
export function FilterChips(
  props: React.ComponentProps<typeof Base.FilterChips>,
) {
  const { colors: c } = useTheme(),
    p = profile();
  if (labState().variant === "actual") return <Base.FilterChips {...props} />;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: p.chipGap }}
    >
      {props.options.map((label) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: label === props.value }}
          aria-pressed={label === props.value}
          onPress={() => props.onChange(label)}
          style={{ minHeight: 48, minWidth: 44, justifyContent: "center" }}
        >
          <View
            style={{
              minHeight: p.chipHeight,
              paddingHorizontal: p.chipPadding,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: label === props.value ? wash(c.wash) : c.surface,
              justifyContent: "center",
            }}
          >
            <Base.Text
              kind="capsule"
              weight="medium"
              style={{
                fontSize: p.chipSize,
                color: label === props.value ? accent(c.accentInk) : c.text2,
              }}
            >
              {label}
              {props.counts?.[label] !== undefined
                ? " " + props.counts[label]
                : ""}
            </Base.Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
