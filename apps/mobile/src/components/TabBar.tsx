import { Pressable, View, useWindowDimensions } from "react-native";
import {
  Inbox,
  PanelsTopLeft,
  Sparkles,
  Megaphone,
  Menu,
  type LucideIcon,
} from "lucide-react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Module, visibleModules } from "../domain/access";
import { useSession } from "../state/SessionProvider";
import { useTheme } from "../theme/ThemeProvider";
import { Text } from "./ui";
const labels: Record<Module, string> = {
  inbox: "Bandeja",
  crm: "CRM",
  studio: "Estudio IA",
  marketing: "Marketing",
  more: "Más",
};
const icons: Record<Module, LucideIcon> = {
  inbox: Inbox,
  crm: PanelsTopLeft,
  studio: Sparkles,
  marketing: Megaphone,
  more: Menu,
};
export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const { session, disabled } = useSession();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  if (!session) return null;
  const allowed = visibleModules(session.role, disabled);
  return (
    <View
      accessibilityRole="tablist"
      style={{
        position: "absolute",
        bottom: insets.bottom + 4,
        left: 12,
        right: 12,
        minHeight: height <= 640 ? 64 : 72,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 22,
        flexDirection: "row",
        padding: 4,
        elevation: 8,
        boxShadow: "0px 4px 20px rgba(0,0,0,0.12)",
      }}
    >
      {state.routes
        .filter((route) => allowed.includes(route.name as Module))
        .map((route) => {
          const selected = state.routes[state.index]?.key === route.key;
          const Icon = icons[route.name as Module];
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={labels[route.name as Module]}
              accessibilityState={{ selected }}
              aria-selected={selected}
              onPress={() => {
                const event = emitter.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!event.defaultPrevented) navigateToTab(route.key);
              }}
              onLongPress={() =>
                emitter.emit({ type: "tabLongPress", target: route.key })
              }
              style={{
                flex: 1,
                minHeight: 48,
                justifyContent: "center",
                alignItems: "center",
                gap: 4,
                borderRadius: 18,
                paddingVertical: 6,
                backgroundColor: selected ? c.wash : "transparent",
              }}
            >
              <Icon
                size={22}
                color={selected ? c.accentInk : c.text3}
                strokeWidth={1.8}
              />
              <Text
                kind="meta"
                weight="medium"
                style={{
                  fontSize: 11.5,
                  color: selected ? c.accentInk : c.text3,
                  textAlign: "center",
                }}
              >
                {labels[route.name as Module]}
              </Text>
            </Pressable>
          );
        })}
    </View>
  );
}
