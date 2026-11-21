import { KeyboardScrollView as ScrollView } from "../features/keyboard/KeyboardScrollView";
import React, { memo, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text as NativeText,
  TextInput,
  View,
  type TextProps,
  type TextInputProps,
  type ViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Inbox,
  Image as ImageIcon,
  Search,
  Send,
  Bot,
  CheckCheck,
  type LucideIcon,
} from "lucide-react-native";
import { useTheme } from "../theme/ThemeProvider";
import { typography } from "../theme/tokens";
import { refinementB, contentCapsule } from "../theme/refinement-b";
export function Text({
  kind = "body",
  weight = "regular",
  style,
  ...props
}: TextProps & {
  kind?: keyof typeof typography;
  weight?: "regular" | "medium" | "semibold";
}) {
  const { colors, fontFamily } = useTheme();
  const [fontSize, lineHeight] = typography[kind];
  return (
    <NativeText
      {...props}
      style={[
        {
          color: colors.text,
          fontFamily: fontFamily(weight),
          fontSize,
          lineHeight,
        },
        style,
      ]}
    />
  );
}
export function IconButton({
  icon: Icon,
  label,
  onPress,
  disabled,
  refinement,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  refinement?: "b";
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Icon
        size={refinement === "b" ? refinementB.iconSize : 22}
        strokeWidth={1.8}
        color={colors.accentInk}
      />
    </Pressable>
  );
}
export function Button({
  children,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon: Icon,
}: {
  children: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "tonal" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
}) {
  const { colors: c } = useTheme();
  const fill =
    variant === "primary"
      ? c.accent
      : variant === "danger"
        ? c.dangerFill
        : variant === "tonal"
          ? c.wash
          : "transparent";
  const color =
    variant === "primary"
      ? c.onAccent
      : variant === "danger"
        ? "#fff"
        : variant === "secondary"
          ? c.text
          : c.accentInk;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{
        disabled: !!disabled || !!loading,
        busy: !!loading,
      }}
      aria-disabled={!!disabled || !!loading}
      aria-busy={!!loading}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: fill,
          borderColor: variant === "secondary" ? c.borderStrong : "transparent",
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} accessibilityLabel="En curso" />
      ) : Icon ? (
        <Icon color={color} size={22} strokeWidth={1.8} />
      ) : null}
      <Text
        weight="semibold"
        style={{ color, textAlign: "center", flexShrink: 1 }}
      >
        {children}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  error,
  hint,
  style,
  ...props
}: TextInputProps & { label: string; error?: string; hint?: string }) {
  const { colors: c, fontFamily } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text weight="medium" kind="secondary">
        {label}
      </Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={c.text3}
        style={[
          styles.input,
          {
            color: c.text,
            fontFamily: fontFamily(),
            backgroundColor: c.surface,
            borderColor: error ? c.danger : c.borderStrong,
          },
          style,
        ]}
      />
      {error ? (
        <Text
          accessibilityRole="alert"
          kind="secondary"
          style={{ color: c.danger }}
        >
          ⓘ {error}
        </Text>
      ) : hint ? (
        <Text kind="secondary" style={{ color: c.text3 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
export function AppBar({
  title,
  onBack,
  module,
  actions,
  refinement,
}: {
  title: string;
  onBack?: () => void;
  module?: boolean;
  actions?: React.ReactNode;
  refinement?: "b";
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        minHeight: 52,
        paddingHorizontal: onBack ? 4 : 16,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      {onBack && (
        <IconButton
          icon={ArrowLeft}
          label="Atrás"
          onPress={onBack}
          refinement={refinement}
        />
      )}
      <Text
        accessibilityRole="header"
        kind={module ? "module" : "title"}
        weight={
          module && refinement === "b" ? refinementB.titleWeight : "semibold"
        }
        style={{
          flex: 1,
          paddingVertical: 8,
          color: module ? colors.accentInk : colors.text,
          ...(module && refinement === "b"
            ? {
                fontSize: refinementB.titleSize,
                lineHeight: refinementB.titleLine,
              }
            : {}),
        }}
      >
        {title}
      </Text>
      {actions}
    </View>
  );
}
export function Card({ style, ...props }: ViewProps) {
  const { colors } = useTheme();
  return (
    <View
      {...props}
      style={[
        {
          padding: 16,
          borderWidth: 1,
          borderRadius: 16,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          gap: 8,
        },
        style,
      ]}
    />
  );
}
export function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <Text kind="secondary">{label}</Text>
      <Text kind="module" weight="semibold">
        {value}
      </Text>
    </Card>
  );
}
export function Section({ children }: React.PropsWithChildren) {
  const { colors } = useTheme();
  return (
    <Text
      kind="capsule"
      weight="semibold"
      style={{
        textTransform: "uppercase",
        color: colors.text3,
        paddingTop: 18,
        paddingBottom: 8,
      }}
    >
      {children}
    </Text>
  );
}
export function Banner({
  children,
  type = "info",
}: React.PropsWithChildren<{
  type?: "info" | "warning" | "danger" | "success";
}>) {
  const { colors: c } = useTheme();
  return (
    <View
      accessibilityRole={type === "danger" ? "alert" : undefined}
      style={{
        backgroundColor: c.base,
        padding: 12,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      <CircleAlert size={18} color={c[type]} />
      <Text kind="secondary" style={{ color: c[type], flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}
export function Avatar({ name, ai }: { name: string; ai?: boolean }) {
  const { colors: c } = useTheme();
  return (
    <View style={{ width: 50, height: 54 }}>
      <View
        style={{
          width: 50,
          height: 50,
          borderRadius: 25,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: c.wash,
        }}
      >
        <Text weight="semibold" style={{ color: c.accentInk }}>
          {name
            .split(" ")
            .slice(0, 2)
            .map((n) => n[0])
            .join("")}
        </Text>
      </View>
      {ai && (
        <View
          accessibilityLabel="IA activa"
          style={{
            position: "absolute",
            bottom: 0,
            left: 16,
            backgroundColor: c.surface,
            borderRadius: 10,
          }}
        >
          <Bot color={c.success} size={18} />
        </View>
      )}
    </View>
  );
}
export function TagCapsule({
  children,
  danger = false,
}: React.PropsWithChildren<{ danger?: boolean }>) {
  const { colors: c } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: contentCapsule.paddingHorizontal,
        paddingVertical: contentCapsule.paddingVertical,
        borderRadius: contentCapsule.radius,
        backgroundColor: danger ? c.base : c.tagBg,
        alignSelf: "flex-start",
      }}
    >
      <Text
        kind="capsule"
        weight="medium"
        style={{ color: danger ? c.danger : c.tagText }}
      >
        {children}
      </Text>
    </View>
  );
}
export function StageCapsule({ children }: React.PropsWithChildren) {
  const { colors: c } = useTheme();
  const stageColors: Record<string, string> = {
    Nuevo: "#94a3b8",
    "En conversación": "#12999d",
    Interesado: "#f59e0b",
    Cliente: "#22c55e",
    Perdido: "#ef4444",
  };
  const dot = stageColors[String(children)] ?? c.accent;
  return (
    <View
      style={{
        paddingHorizontal: contentCapsule.paddingHorizontal,
        paddingVertical: contentCapsule.paddingVertical,
        borderRadius: contentCapsule.radius,
        backgroundColor: c.sunken,
        flexDirection: "row",
        gap: 5,
        alignItems: "center",
        alignSelf: "flex-start",
      }}
    >
      <View
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }}
      />
      <Text kind="capsule" weight="medium" style={{ color: c.text2 }}>
        {children}
      </Text>
    </View>
  );
}
export function UnreadBadge({ count }: { count: number }) {
  const { colors: c } = useTheme();
  return count ? (
    <View
      accessibilityLabel={`${count} sin leer`}
      style={{
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        paddingHorizontal: 5,
        backgroundColor: c.accent,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text kind="meta" weight="medium" style={{ color: c.onAccent }}>
        {count > 99 ? "99+" : count}
      </Text>
    </View>
  ) : null;
}
export const ListRow = memo(function ListRow({
  name,
  preview,
  onPress,
  unread = 0,
  stage,
  ai,
  time,
}: {
  name: string;
  preview: string;
  onPress: () => void;
  unread?: number;
  stage?: string;
  ai?: boolean;
  time?: string;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${preview}${unread ? `, ${unread} sin leer` : ""}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: 12,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderColor: c.border,
        backgroundColor: pressed ? c.tint : c.surface,
      })}
    >
      <Avatar name={name} ai={ai} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text kind="name" weight="medium" numberOfLines={1}>
          {name}
        </Text>
        <Text kind="secondary" numberOfLines={1} style={{ color: c.text3 }}>
          {preview}
        </Text>
        {stage && <StageCapsule>{stage}</StageCapsule>}
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Text kind="meta" style={{ color: c.text3 }}>
          {time}
        </Text>
        <UnreadBadge count={unread} />
      </View>
    </Pressable>
  );
});
export function PickerRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={{
        minHeight: 48,
        flexDirection: "row",
        gap: 8,
        alignItems: "center",
        paddingVertical: 8,
      }}
    >
      <Text style={{ flex: 1 }}>{label}</Text>
      <Text kind="secondary" style={{ color: c.text3, flexShrink: 1 }}>
        {value}
      </Text>
      <ChevronDown size={18} color={c.text3} />
    </Pressable>
  );
}
export function NavRow({
  label,
  onPress,
  hint,
  end,
  icon: Icon = ChevronRight,
}: {
  label: string;
  hint?: string;
  end?: string;
  onPress: () => void;
  icon?: LucideIcon;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={{
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: 1,
        borderColor: c.border,
        gap: 12,
        paddingVertical: 10,
      }}
    >
      <Icon color={c.accentInk} size={22} strokeWidth={1.8} />
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
        {!!hint && (
          <Text kind="meta" style={{ color: c.text3 }}>
            {hint}
          </Text>
        )}
      </View>
      {end && <Text kind="meta">{end}</Text>}
      <ChevronRight color={c.text3} size={18} />
    </Pressable>
  );
}
export function SegmentedControl({
  options,
  value,
  onChange,
  refinement,
  fixedGeometry = false,
}: {
  options: readonly { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  refinement?: "b" | "crm";
  fixedGeometry?: boolean;
}) {
  const { colors: c, reducedMotion } = useTheme(),
    crm = refinement === "crm",
    fixed = crm || fixedGeometry,
    b = refinement === "b",
    padding = crm ? 4 : b ? refinementB.trackPadding : 4,
    itemHeight = crm ? 40 : 48,
    height = itemHeight + padding * 2;
  const [width, setWidth] = useState(0),
    position = useRef(new Animated.Value(0)).current,
    last = useRef({ width: 0, count: options.length }),
    index = Math.max(
      0,
      options.findIndex((o) => o.key === value),
    ),
    cell = Math.max(0, width - padding * 2) / Math.max(1, options.length),
    radius = crm ? 24 : b ? refinementB.trackRadius : 12,
    itemRadius = crm ? 20 : b ? refinementB.itemRadius : 10;
  useLayoutEffect(() => {
    if (!fixed) return;
    const x = index * cell;
    if (
      reducedMotion ||
      last.current.width !== width ||
      last.current.count !== options.length
    ) {
      position.setValue(x);
    } else {
      const a = Animated.timing(position, {
        toValue: x,
        duration: 160,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== "web",
      });
      a.start();
      last.current = { width, count: options.length };
      return () => a.stop();
    }
    last.current = { width, count: options.length };
  }, [width, cell, index, options.length, position, reducedMotion, fixed]);
  return (
    <View
      accessibilityRole="tablist"
      testID="original-segments"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        flexDirection: "row",
        backgroundColor: crm ? c.sunken : c.base,
        borderRadius: radius,
        padding,
        height: fixed ? height : undefined,
      }}
    >
      {fixed && width > 0 && (
        <Animated.View
          pointerEvents="none"
          testID="original-segment-indicator"
          style={{
            position: "absolute",
            left: padding,
            top: padding,
            width: cell,
            height: fixed ? itemHeight : undefined,
            minHeight: fixed ? undefined : itemHeight,
            borderRadius: itemRadius,
            backgroundColor: c.surface,
            transform: [{ translateX: position }],
          }}
        />
      )}
      {options.map((option) => (
        <Pressable
          key={option.key}
          accessibilityRole="tab"
          accessibilityLabel={option.label}
          accessibilityState={{ selected: value === option.key }}
          aria-selected={value === option.key}
          onPress={() => onChange(option.key)}
          hitSlop={crm ? 4 : undefined}
          style={{
            flex: 1,
            height: fixed ? itemHeight : undefined,
            minHeight: fixed ? undefined : itemHeight,
            borderRadius: itemRadius,
            paddingHorizontal: crm ? 0 : 4,
            paddingVertical: crm ? 0 : 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              (!fixed || width === 0) && value === option.key
                ? c.surface
                : "transparent",
          }}
        >
          <Text
            kind="secondary"
            weight="medium"
            numberOfLines={fixed ? 1 : undefined}
            style={{
              textAlign: "center",
              fontSize: b
                ? refinementB.labelSize
                : crm
                  ? refinementB.secondarySize
                  : 14,
              color:
                value === option.key ? c.accentInk : crm ? c.text2 : c.text3,
            }}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function FilterChips({
  options,
  value,
  onChange,
  counts,
  refinement,
}: {
  options: readonly string[];
  value: string;
  counts?: Record<string, number>;
  onChange: (value: string) => void;
  refinement?: "b";
}) {
  const { colors: c } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: refinement === "b" ? refinementB.chipGap : 8,
      }}
    >
      {options.map((label) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: label === value }}
          aria-pressed={label === value}
          onPress={() => onChange(label)}
          style={{ minHeight: 48, minWidth: 44, justifyContent: "center" }}
        >
          <View
            style={{
              minHeight: refinement === "b" ? refinementB.chipHeight : 36,
              paddingHorizontal:
                refinement === "b" ? refinementB.chipPadding : 14,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: value === label ? c.wash : c.surface,
              justifyContent: "center",
            }}
          >
            <Text
              kind="capsule"
              weight="medium"
              style={{ color: value === label ? c.accentInk : c.text2 }}
            >
              {label}
              {counts?.[label] !== undefined ? ` ${counts[label]}` : ""}
            </Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
export function SearchBox(props: TextInputProps) {
  const { colors: c, fontFamily } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: c.base,
        borderRadius: 12,
        paddingHorizontal: 12,
      }}
    >
      <Search size={20} color={c.text3} />
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? "Buscar"}
        placeholderTextColor={c.text3}
        style={{
          flex: 1,
          minHeight: 48,
          fontSize: 16,
          color: c.text,
          fontFamily: fontFamily(),
        }}
      />
    </View>
  );
}
export function Switch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      aria-checked={value}
      onPress={() => onChange(!value)}
      style={{
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <Text style={{ flex: 1 }}>{label}</Text>
      <View
        style={{
          width: 50,
          height: 30,
          borderRadius: 15,
          padding: 3,
          backgroundColor: value ? c.accent : c.borderStrong,
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: "#fff",
            alignSelf: value ? "flex-end" : "flex-start",
          }}
        />
      </View>
    </Pressable>
  );
}

export function Choice({
  label,
  checked,
  onPress,
  radio,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
  radio?: boolean;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole={radio ? "radio" : "checkbox"}
      accessibilityState={{ checked }}
      aria-checked={checked}
      onPress={onPress}
      style={{
        minHeight: 48,
        flexDirection: "row",
        gap: 12,
        alignItems: "center",
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radio ? 11 : 5,
          borderWidth: 2,
          borderColor: checked ? c.accent : c.borderStrong,
          backgroundColor: checked ? c.wash : c.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: radio ? 5 : 1,
              backgroundColor: c.accent,
            }}
          />
        )}
      </View>
      <Text style={{ flex: 1 }}>{label}</Text>
    </Pressable>
  );
}
export function Skeleton({ rows = 2 }: { rows?: number }) {
  const { colors: c } = useTheme();
  return (
    <View
      accessibilityLabel="Cargando"
      accessibilityState={{ busy: true }}
      aria-busy
    >
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={i}
          style={{ flexDirection: "row", gap: 12, paddingVertical: 12 }}
        >
          <View
            style={{
              width: 50,
              height: 50,
              borderRadius: 25,
              backgroundColor: c.border,
            }}
          />
          <View style={{ flex: 1, gap: 10 }}>
            <View
              style={{
                width: "60%",
                height: 16,
                borderRadius: 6,
                backgroundColor: c.border,
              }}
            />
            <View
              style={{
                width: "85%",
                height: 13,
                borderRadius: 6,
                backgroundColor: c.border,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
export function EmptyState({
  title = "Sin chats",
  message = "Cuando un cliente escriba, aparecerá aquí.",
  action,
  icon: Icon = Inbox,
}: {
  title?: string;
  message?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={{ paddingVertical: 28, alignItems: "center", gap: 10 }}>
      <Icon size={34} color={c.text3} strokeWidth={1.8} />
      <Text weight="semibold" style={{ textAlign: "center" }}>
        {title}
      </Text>
      <Text kind="secondary" style={{ textAlign: "center", color: c.text3 }}>
        {message}
      </Text>
      {action}
    </View>
  );
}
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={CircleAlert}
      title="No pudimos cargar los datos"
      message="Revisa tu conexión e intenta de nuevo."
      action={
        <Button variant="tonal" onPress={onRetry}>
          Reintentar
        </Button>
      }
    />
  );
}
export function MessageBubble({
  children,
  variant = "in",
  attachment,
  failed,
  onRetry,
}: React.PropsWithChildren<{
  variant?: "in" | "team" | "ai" | "connected" | "note" | "system";
  attachment?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}>) {
  const { colors: c } = useTheme();
  const outgoing = ["team", "ai", "connected"].includes(variant);
  const bg =
    variant === "ai"
      ? c.bubbleAi
      : variant === "connected"
        ? c.bubbleConnected
        : variant === "team"
          ? c.bubbleTeam
          : variant === "note"
            ? c.wash
            : c.bubbleIn;
  return (
    <View
      style={{
        alignSelf:
          variant === "system" || variant === "note"
            ? "center"
            : outgoing
              ? "flex-end"
              : "flex-start",
        maxWidth: "88%",
        backgroundColor: variant === "system" ? "transparent" : bg,
        borderRadius: 16,
        padding: 12,
        gap: 6,
      }}
    >
      {attachment && (
        <View
          accessibilityLabel="Vista previa de imagen ficticia"
          style={{
            width: 230,
            maxWidth: "100%",
            height: 150,
            borderRadius: 10,
            backgroundColor: "#4a9ea3",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ImageIcon size={34} color="#fff" strokeWidth={1.8} />
        </View>
      )}
      <Text kind={variant === "system" ? "meta" : "body"}>
        {variant === "ai"
          ? "✧ IA · "
          : variant === "connected"
            ? "✧ Joe · IA de Ana · "
            : variant === "note"
              ? "Nota interna · "
              : ""}
        {children}
      </Text>
      {variant !== "system" && (
        <View
          style={{ flexDirection: "row", justifyContent: "flex-end", gap: 4 }}
        >
          <Text kind="meta" style={{ color: c.text2 }}>
            9:13
          </Text>
          {outgoing && (
            <CheckCheck size={15} color={failed ? c.danger : c.info} />
          )}
        </View>
      )}
      {failed && (
        <>
          <Text kind="meta" style={{ color: c.danger }}>
            No entregado. Pasaron más de 24 h.
          </Text>
          {onRetry && (
            <Button variant="ghost" onPress={onRetry}>
              Reintentar
            </Button>
          )}
        </>
      )}
    </View>
  );
}
export function TypingIndicator() {
  const { colors: c } = useTheme();
  return (
    <View
      accessibilityLabel="Escribiendo"
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        gap: 4,
        backgroundColor: c.bubbleIn,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: c.text3,
          }}
        />
      ))}
    </View>
  );
}
export function Composer({
  value,
  onChange,
  onSend,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
}) {
  const { colors: c, fontFamily } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 4,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: c.borderStrong,
        padding: 4,
        backgroundColor: c.surface,
      }}
    >
      <TextInput
        accessibilityLabel="Mensaje de prueba"
        placeholder="Escribe un mensaje…"
        placeholderTextColor={c.text3}
        multiline
        maxLength={4096}
        value={value}
        onChangeText={onChange}
        style={{
          flex: 1,
          minHeight: 44,
          maxHeight: 120,
          padding: 10,
          color: c.text,
          fontSize: 15,
          fontFamily: fontFamily(),
        }}
      />
      <IconButton
        icon={Send}
        label="Enviar mensaje de prueba"
        onPress={onSend}
        disabled={!value.trim()}
      />
    </View>
  );
}
export function PageScroll({
  children,
  style,
}: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        { padding: 16, gap: 12, paddingBottom: 32 },
        style,
      ]}
    >
      {children}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
});
