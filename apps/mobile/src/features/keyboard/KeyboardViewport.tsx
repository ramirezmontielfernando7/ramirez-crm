import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  View,
  type ViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { keyboardOverlap } from "./geometry";
import { useKeyboardFrame } from "./state";
/** One owner of IME occlusion per native window; no assumed keyboard height or nested avoiding view. */
export function KeyboardViewport({
  children,
  enabled = true,
  style,
  contentStyle,
  onLayout,
  ...props
}: ViewProps & { enabled?: boolean; contentStyle?: StyleProp<ViewStyle> }) {
  const host = useRef<React.ElementRef<typeof View>>(null),
    keyboard = useKeyboardFrame(),
    [bottom, setBottom] = useState(0),
    tick = useRef<number | null>(null),
    generation = useRef(0);
  const measure = useCallback(() => {
    const version = ++generation.current;
    if (tick.current !== null) cancelAnimationFrame(tick.current);
    if (!enabled || Platform.OS === "web" || !keyboard.visible) {
      setBottom(0);
      return;
    }
    tick.current = requestAnimationFrame(() => {
      tick.current = null;
      host.current?.measureInWindow((x, y, width, height) => {
        if (generation.current === version)
          setBottom(keyboardOverlap({ x, y, width, height }, keyboard.frame));
      });
    });
  }, [enabled, keyboard]);
  useEffect(() => {
    measure();
    return () => {
      generation.current++;
      if (tick.current !== null) cancelAnimationFrame(tick.current);
    };
  }, [measure]);
  return (
    <View
      {...props}
      ref={host}
      collapsable={false}
      onLayout={(e) => {
        onLayout?.(e);
        measure();
      }}
      style={[{ flex: 1, minHeight: 0 }, style]}
    >
      <View style={{ flex: 1, minHeight: 0, paddingBottom: bottom }}>
        <View style={[{ flex: 1, minHeight: 0 }, contentStyle]}>
          {children}
        </View>
      </View>
    </View>
  );
}
