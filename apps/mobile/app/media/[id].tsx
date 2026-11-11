import React, { useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  View,
  useWindowDimensions,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Download, Minus, Plus, RotateCcw, X } from "lucide-react-native";
import { Screen } from "../../src/components/Screen";
import { Button, EmptyState, Text } from "../../src/components/ui";
import { useChatDirectory } from "../../src/features/chat/context";
import { useLayers } from "../../src/components/Layers";
import { SamplePicture } from "../../src/features/chat/Picture";
function ImageViewer() {
  const { id, conversation } = useLocalSearchParams<{
    id: string;
    conversation: string;
  }>();
  const directory = useChatDirectory();
  const { toast } = useLayers();
  const size = useWindowDimensions();
  const [zoom, setZoom] = useState(1);
  const current = useRef(1);
  const scale = useRef(new Animated.Value(1)).current;
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const drag = useRef({ x: 0, y: 0, start: 0, scale: 1, bx: 0, by: 0 });
  const set = (value: number) => {
    current.current = Math.min(3, Math.max(1, value));
    scale.setValue(current.current);
    x.setValue(0);
    y.setValue(0);
    drag.current.x = 0;
    drag.current.y = 0;
    setZoom(current.current);
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          g.numberActiveTouches > 1 || current.current > 1,
        onPanResponderGrant: (e) => {
          const t = e.nativeEvent.touches;
          drag.current = {
            ...drag.current,
            start:
              t.length >= 2
                ? Math.hypot(
                    t[0]!.pageX - t[1]!.pageX,
                    t[0]!.pageY - t[1]!.pageY,
                  )
                : 0,
            scale: current.current,
            bx: drag.current.x,
            by: drag.current.y,
          };
        },
        onPanResponderMove: (e, g) => {
          const t = e.nativeEvent.touches;
          if (t.length >= 2) {
            const distance = Math.hypot(
              t[0]!.pageX - t[1]!.pageX,
              t[0]!.pageY - t[1]!.pageY,
            );
            if (!drag.current.start) {
              drag.current.start = distance;
              drag.current.scale = current.current;
            }
            current.current = Math.max(
              1,
              Math.min(3, (drag.current.scale * distance) / drag.current.start),
            );
            scale.setValue(current.current);
          } else {
            const maxX = (size.width * (current.current - 1)) / 2;
            const maxY = (size.height * (current.current - 1)) / 3;
            drag.current.x = Math.max(
              -maxX,
              Math.min(maxX, drag.current.bx + g.dx),
            );
            drag.current.y = Math.max(
              -maxY,
              Math.min(maxY, drag.current.by + g.dy),
            );
            x.setValue(drag.current.x);
            y.setValue(drag.current.y);
          }
        },
        onPanResponderRelease: () => setZoom(current.current),
      }),
    [scale, x, y, size.width, size.height],
  );
  let valid = false;
  try {
    const chat = directory.get(conversation ?? "");
    valid = chat
      .snapshot()
      .messages.some((m) => m.id === id && m.attachment?.kind === "image");
  } catch {}
  if (!valid)
    return (
      <Screen>
        <EmptyState
          title="Imagen no disponible"
          message="Abre una imagen de una conversación a la que tengas acceso."
          action={
            <Button onPress={() => router.replace("/(tabs)/inbox")}>
              Volver a Bandeja
            </Button>
          }
        />
      </Screen>
    );
  const control = (label: string, Icon: typeof Plus, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 48,
        height: 48,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={24} color="#fff" strokeWidth={1.8} />
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" />
      <Screen backgroundColor="#000">
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 8,
            }}
          >
            {control("Cerrar imagen", X, () =>
              router.canGoBack()
                ? router.back()
                : router.replace(`/conversation/${conversation}`),
            )}
            <Text
              kind="title"
              weight="semibold"
              style={{ flex: 1, color: "#fff" }}
            >
              Imagen de muestra
            </Text>
            {control("Compartir o guardar muestra", Download, () =>
              toast("Compartir o guardar · Acción simulada, sin apps externas"),
            )}
          </View>
          <View
            {...pan.panHandlers}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <Animated.View
              style={{
                width: "90%",
                transform: [{ translateX: x }, { translateY: y }, { scale }],
              }}
            >
              <SamplePicture height={Math.min(size.width * 0.675, 320)} />
            </Animated.View>
          </View>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "center",
              alignItems: "center",
              gap: 12,
              paddingBottom: 16,
            }}
          >
            {control("Reducir zoom", Minus, () => set(current.current - 0.25))}
            <Text accessibilityLiveRegion="polite" style={{ color: "#fff" }}>
              {Math.round(zoom * 100)}%
            </Text>
            {control("Aumentar zoom", Plus, () => set(current.current + 0.25))}
            {control("Restablecer zoom", RotateCcw, () => set(1))}
          </View>
        </View>
      </Screen>
    </View>
  );
}
export default ImageViewer;
