import { useKeyboardFrame } from "../features/keyboard/state";
import { useOptionalPersonalization } from "../features/personalization/state";
import { useInboxUnread, useOptionalInbox } from "../features/inbox/store";
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
import { Text, UnreadBadge } from "./ui";
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
  const personalization = useOptionalPersonalization();
  const unread = useInboxUnread();
  const inbox = useOptionalInbox();
  const { session, disabled } = useSession();
  if (!session) return null;
  const allowed =
    personalization?.navigation(session.role, disabled) ??
    visibleModules(session.role, disabled);
  const selected = state.routes[state.index]?.name;
  return (
    <ModuleTabBar
      modules={allowed.filter((name) =>
        state.routes.some((route) => route.name === name),
      )}
      selected={selected}
      unread={unread}
      onPress={(name) => {
        const route = state.routes.find((entry) => entry.name === name);
        if (!route) return;
        if (selected === "inbox" && name === "inbox") inbox?.scrollToTop();
        const event = emitter.emit({
          type: "tabPress",
          target: route.key,
          canPreventDefault: true,
        });
        if (!event.defaultPrevented) navigateToTab(route.key);
      }}
      onLongPress={(name) => {
        const route = state.routes.find((entry) => entry.name === name);
        if (route) emitter.emit({ type: "tabLongPress", target: route.key });
      }}
    />
  );
}

export function ModuleTabBar({
  modules,
  selected,
  unread = 0,
  onPress,
  onLongPress,
}: {
  modules: readonly Module[];
  selected?: string;
  unread?: number;
  onPress: (name: Module) => void;
  onLongPress?: (name: Module) => void;
}) {
  const keyboard = useKeyboardFrame();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  if (keyboard.visible) return null;
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Navegación principal"
      style={{
        position: "absolute",
        bottom: insets.bottom + 4,
        left: 12,
        right: 12,
        minHeight: height <= 640 ? 64 : 72,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 24,
        flexDirection: "row",
        padding: 4,
        elevation: 8,
        boxShadow: "0px 4px 20px rgba(0,0,0,0.12)",
      }}
    >
      {modules.map((name) => {
        const active = selected === name;
        const Icon = icons[name];
        const label = labels[name];
        return (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            aria-selected={active}
            onPress={() => onPress(name)}
            onLongPress={onLongPress ? () => onLongPress(name) : undefined}
            style={{
              flex: 1,
              minHeight: 48,
              justifyContent: "center",
              alignItems: "center",
              gap: 4,
              borderRadius: 18,
              paddingVertical: 6,
              backgroundColor: active ? c.wash : "transparent",
            }}
          >
            {name === "inbox" && unread > 0 && (
              <View style={{ position: "absolute", top: 0, right: 4 }}>
                <UnreadBadge count={unread} />
              </View>
            )}
            <Icon
              size={22}
              color={active ? c.accentInk : c.text3}
              strokeWidth={1.8}
            />
            <Text
              kind="meta"
              weight="medium"
              style={{
                fontSize: 11.5,
                color: active ? c.accentInk : c.text3,
                textAlign: "center",
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
