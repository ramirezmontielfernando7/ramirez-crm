import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { IconButton, Text } from "./ui";
type Layer = {
  kind: "sheet" | "dialog" | "menu";
  title: string;
  content: React.ReactNode;
};
const Context = createContext<{
  layer: Layer | null;
  open: (layer: Layer) => void;
  close: () => void;
  toast: (text: string) => void;
}>(null!);
export function LayerProvider({ children }: React.PropsWithChildren) {
  const [layer, setLayer] = useState<Layer | null>(null);
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useCallback(() => setLayer(null), []);
  const { colors: c, reducedMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const toast = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(""), 3000);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (Platform.OS !== "web" || !layer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [layer, close]);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
      onPanResponderRelease: (_, g) => {
        if (g.dy > 40) close();
      },
    }),
  ).current;
  return (
    <Context.Provider value={{ layer, open: setLayer, close, toast }}>
      <View
        style={{ flex: 1 }}
        aria-hidden={!!layer}
        accessibilityElementsHidden={!!layer}
        importantForAccessibility={layer ? "no-hide-descendants" : "auto"}
        pointerEvents={layer ? "none" : "auto"}
      >
        {children}
      </View>
      <Modal
        visible={!!layer}
        transparent
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={close}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{
            flex: 1,
            justifyContent:
              layer?.kind === "sheet"
                ? "flex-end"
                : layer?.kind === "menu"
                  ? "flex-start"
                  : "center",
            paddingTop: insets.top,
            paddingHorizontal: layer?.kind === "sheet" ? 0 : 20,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar capa"
            onPress={close}
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: c.overlay,
            }}
          />
          <View
            accessibilityViewIsModal
            style={{
              backgroundColor: c.surface,
              borderRadius: layer?.kind === "sheet" ? 22 : 16,
              borderBottomLeftRadius: layer?.kind === "sheet" ? 0 : 16,
              borderBottomRightRadius: layer?.kind === "sheet" ? 0 : 16,
              padding: 16,
              paddingBottom:
                layer?.kind === "sheet" ? Math.max(20, insets.bottom) : 16,
              maxHeight: height * 0.88,
              marginTop: layer?.kind === "menu" ? 12 : 0,
            }}
          >
            {layer?.kind === "sheet" && (
              <View
                {...pan.panHandlers}
                accessibilityLabel="Desliza hacia abajo para cerrar"
                style={{ height: 20, alignItems: "center" }}
              >
                <View
                  style={{
                    width: 36,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: c.borderStrong,
                  }}
                />
              </View>
            )}
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Text
                accessibilityRole="header"
                kind="title"
                weight="semibold"
                style={{ flex: 1 }}
              >
                {layer?.title}
              </Text>
              <IconButton icon={X} label="Cerrar" onPress={close} />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: 12, paddingTop: 8 }}
            >
              {layer?.content}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {!!message && (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={{
            position: "absolute",
            bottom: insets.bottom + 88,
            left: 20,
            right: 20,
            backgroundColor: c.text,
            padding: 14,
            borderRadius: 12,
          }}
        >
          <Text style={{ color: c.surface, textAlign: "center" }}>
            {message}
          </Text>
        </View>
      )}
    </Context.Provider>
  );
}
export const useLayers = () => useContext(Context);
