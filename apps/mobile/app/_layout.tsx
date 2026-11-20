import React, { useEffect, useRef } from "react";
import { BackHandler, Platform, View } from "react-native";
import { Stack, router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import { SessionProvider, useSession } from "../src/state/SessionProvider";
import { LayerProvider, useLayers } from "../src/components/Layers";
import { Skeleton } from "../src/components/ui";
import { resolveBack } from "../src/domain/access";
import { InboxProvider, useOptionalInbox } from "../src/features/inbox/store";
import { ContactProvider } from "../src/features/contact/context";
import { ChatProvider } from "../src/features/chat/context";
import { NotificationProvider } from "../src/features/notifications/context";
function RootNavigator() {
  const { ready, session } = useSession();
  const inbox = useOptionalInbox();
  const { colors, dark } = useTheme();
  const { layer, close, toast } = useLayers();
  const pathname = usePathname();
  const lastPress = useRef<number | null>(null);
  const [fonts, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  useEffect(() => {
    close();
  }, [session?.id, pathname, close]);
  useEffect(() => {
    lastPress.current = null;
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!layer && pathname === "/inbox" && inbox) {
          const state = inbox.snapshot();
          if (state.selecting) {
            inbox.cancel();
            return true;
          }
          if (state.searching) {
            inbox.patch({ searching: false });
            inbox.filter({ query: "" });
            return true;
          }
        }
        const roots = ["/inbox", "/crm", "/studio", "/marketing", "/more"];
        const nested = !roots.includes(pathname) && router.canGoBack();
        const action = resolveBack(
          !!layer,
          nested,
          pathname === "/inbox",
          lastPress.current,
          Date.now(),
        );
        if (action === "close-layer") close();
        else if (action === "pop") router.back();
        else if (action === "inbox" && session) router.replace("/(tabs)/inbox");
        else if (action === "exit") return false;
        else if (!session && router.canGoBack()) router.back();
        else {
          lastPress.current = Date.now();
          toast("Pulsa otra vez para salir");
        }
        return true;
      },
    );
    return () => subscription.remove();
  }, [pathname, layer, close, session, toast, inbox]);
  if (!ready || (!fonts && !fontError))
    return (
      <View
        style={{
          flex: 1,
          padding: 24,
          paddingTop: 64,
          backgroundColor: colors.surface,
        }}
      >
        <Skeleton rows={4} />
      </View>
    );
  if (fontError) throw fontError;
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.surface },
          animation: "none",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Protected guard={!session}>
          <Stack.Screen name="login" />
          <Stack.Screen name="activar/[token]" />
          <Stack.Screen name="restablecer/[token]" />
          <Stack.Screen name="register" />
        </Stack.Protected>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="conversation/[id]" />
          <Stack.Screen name="media/[id]" />
          <Stack.Screen name="contact/[id]" />
          <Stack.Screen name="history/[id]" />
          <Stack.Screen name="agenda" />
          <Stack.Screen name="work" />
          <Stack.Screen name="results" />
          <Stack.Screen name="studio-create" />
          <Stack.Screen name="studio-evaluation/[id]" />
          <Stack.Screen name="assistant" />
          <Stack.Screen name="team-lab" />
          <Stack.Screen name="internal-supervision-lab" />
          <Stack.Screen name="internal-settings" />
          <Stack.Screen name="personal-settings" />
          <Stack.Screen name="optout" />
          <Stack.Screen name="ai-connector-settings" />
          <Stack.Screen name="my-ai" />
          <Stack.Screen name="template-detail" />
          <Stack.Screen name="template-new" />
          <Stack.Screen name="template-lab" />
          <Stack.Screen name="audience-detail" />
          <Stack.Screen name="campaign-new" />
          <Stack.Screen name="campaign-detail" />
          <Stack.Screen name="campaign-settings" />
          <Stack.Screen name="campaign-lab" />
          <Stack.Screen name="my-ai-activity" />
          <Stack.Screen name="ai-connector-lab" />
          <Stack.Screen name="optout-lab" />
          <Stack.Screen name="personal-chat" />
          <Stack.Screen name="internal-chat/[id]" />
          <Stack.Screen name="internal-info/[id]" />
          <Stack.Screen name="team" />
          <Stack.Screen name="calendar-settings" />
          <Stack.Screen name="tags" />
          <Stack.Screen name="loss-reasons" />
          <Stack.Screen name="quick-replies" />
          <Stack.Screen name="notification-settings" />
          <Stack.Screen name="usage" />
          <Stack.Screen name="plans" />
          <Stack.Screen name="demo-usage" />
          <Stack.Screen name="studio-agent/[id]" />
          <Stack.Screen name="library/[id]" />
        </Stack.Protected>
        <Stack.Screen name="demo" />
        <Stack.Screen name="design/[id]" />
      </Stack>
    </>
  );
}
export default function Layout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <InboxProvider>
            <ContactProvider>
              <ChatProvider>
                <NotificationProvider>
                  <LayerProvider>
                    <RootNavigator />
                  </LayerProvider>
                </NotificationProvider>
              </ChatProvider>
            </ContactProvider>
          </InboxProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export { ErrorBoundary } from "expo-router";
