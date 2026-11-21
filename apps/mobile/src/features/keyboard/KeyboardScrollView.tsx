import React, { forwardRef, useCallback, useEffect, useRef } from "react";
import {
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  type ScrollViewProps,
} from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { revealScrollDelta } from "./geometry";
import { useKeyboardFrame } from "./state";
/** Same ScrollView API. Reveals the focused input after IME/window layout and on focus changes. */
export type KeyboardScrollView = React.ElementRef<typeof ScrollView>;
export const KeyboardScrollView = forwardRef<
  KeyboardScrollView,
  ScrollViewProps
>(function KeyboardScrollView(
  {
    onFocusCapture,
    onBlurCapture,
    onLayout,
    onContentSizeChange,
    onScroll,
    scrollEventThrottle = 16,
    keyboardShouldPersistTaps = "handled",
    keyboardDismissMode = "on-drag",
    ...props
  },
  ref,
) {
  const { reducedMotion } = useTheme();
  const animate = useRef(!reducedMotion);
  animate.current = !reducedMotion;
  const scroll = useRef<KeyboardScrollView | null>(null),
    ownsFocus = useRef(false),
    frame = useKeyboardFrame(),
    visible = useRef(false),
    raf = useRef<number | null>(null),
    position = useRef({ x: 0, y: 0 }),
    keyboard = useRef(frame.frame),
    generation = useRef(0);
  keyboard.current = frame.frame;
  visible.current = frame.visible;
  const reveal = useCallback(() => {
    const version = ++generation.current;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      if (
        !ownsFocus.current ||
        Platform.OS === "web" ||
        (!visible.current && !Keyboard.isVisible())
      )
        return;
      const focused = TextInput.State.currentlyFocusedInput();
      if (focused)
        scroll.current?.measureInWindow((x, y, width, height) =>
          focused.measureInWindow((ix, iy, iw, ih) => {
            if (
              generation.current !== version ||
              !ownsFocus.current ||
              !visible.current
            )
              return;
            const delta = revealScrollDelta(
              { x: ix, y: iy, width: iw, height: ih },
              { x, y, width, height },
              keyboard.current,
            );
            if (Math.abs(delta) > 0.5)
              scroll.current?.scrollTo({
                x: position.current.x,
                y: Math.max(0, position.current.y + delta),
                animated: animate.current,
              });
          }),
        );
    });
  }, []);
  useEffect(() => {
    if (frame.visible) reveal();
    return () => {
      generation.current++;
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [frame, reveal]);
  return (
    <ScrollView
      {...props}
      ref={(node) => {
        scroll.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode={keyboardDismissMode}
      automaticallyAdjustKeyboardInsets={false}
      onFocusCapture={(e) => {
        ownsFocus.current = true;
        onFocusCapture?.(e);
        reveal();
      }}
      onBlurCapture={(e) => {
        ownsFocus.current = false;
        generation.current++;
        onBlurCapture?.(e);
      }}
      scrollEventThrottle={scrollEventThrottle}
      onScroll={(e) => {
        position.current = e.nativeEvent.contentOffset;
        onScroll?.(e);
      }}
      onContentSizeChange={(w, h) => {
        onContentSizeChange?.(w, h);
        if (frame.visible) reveal();
      }}
      onLayout={(e) => {
        onLayout?.(e);
        if (frame.visible) reveal();
      }}
    />
  );
});
