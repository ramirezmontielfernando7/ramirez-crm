import React from "react";
import { Pressable, View } from "react-native";
import {
  Check,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from "lucide-react-native";
import { Text } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
export function DetailRow({
  label,
  value,
  icon: Icon,
  onPress,
  valueDot,
}: {
  label: string;
  value?: string;
  icon: LucideIcon;
  onPress?: () => void;
  valueDot?: string;
}) {
  const { colors: c } = useTheme();
  const content = (
    <>
      <Icon size={22} color={c.text2} strokeWidth={1.8} />
      <Text style={{ flex: 1 }}>{label}</Text>
      {valueDot && <Dot color={valueDot} />}
      {value !== undefined && (
        <Text
          kind="secondary"
          style={{
            color: c.text3,
            flexShrink: 1,
            textAlign: "right",
            maxWidth: "48%",
          }}
        >
          {value}
        </Text>
      )}
      {onPress && <ChevronRight size={18} color={c.text3} />}
    </>
  );
  const style = {
    minHeight: 52,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  };
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}${value ? ` · ${value}` : ""}`}
      onPress={onPress}
      style={style}
    >
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
}
export function Option({
  label,
  sub,
  checked,
  onPress,
  disabled = false,
  kind = "radio",
  leading,
  hideLabel = false,
}: {
  label: string;
  sub?: string;
  checked: boolean;
  onPress: () => void;
  disabled?: boolean;
  kind?: "radio" | "checkbox";
  leading?: React.ReactNode;
  hideLabel?: boolean;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole={kind}
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {leading}
      <View style={{ flex: 1, gap: 3 }}>
        {!hideLabel && <Text>{label}</Text>}
        {sub && (
          <Text kind="secondary" style={{ color: c.text3 }}>
            {sub}
          </Text>
        )}
      </View>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: kind === "radio" ? 12 : 6,
          borderWidth: 2,
          borderColor: checked ? c.accent : c.borderStrong,
          backgroundColor: checked ? c.accent : c.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Check size={17} color={c.onAccent} />}
      </View>
    </Pressable>
  );
}
export function SelectField({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text kind="secondary" weight="semibold">
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} · ${value}`}
        accessibilityState={{ disabled: !onPress }}
        disabled={!onPress}
        onPress={onPress}
        style={{
          borderWidth: 1,
          borderColor: c.borderStrong,
          borderRadius: 12,
          minHeight: 48,
          paddingHorizontal: 14,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text style={{ flex: 1 }}>{value}</Text>
        <ChevronDown size={20} color={c.text2} />
      </Pressable>
    </View>
  );
}
export const stageColor = (stage: string) =>
  ({
    Nuevo: "#94a3b8",
    "En conversación": "#12999d",
    Interesado: "#f59e0b",
    Cliente: "#22c55e",
    Perdido: "#ef4444",
  })[stage] ?? "#94a3b8";
export const Dot = ({ color }: { color: string }) => (
  <View
    style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }}
  />
);
