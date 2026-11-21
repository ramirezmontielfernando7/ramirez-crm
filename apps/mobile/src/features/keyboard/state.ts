import { useSyncExternalStore } from "react";
import { Keyboard, Platform, type KeyboardEvent } from "react-native";
import type { Rect } from "./geometry";
type Snapshot = Readonly<{ visible: boolean; frame: Rect | null }>;
const hidden: Snapshot = Object.freeze({ visible: false, frame: null });
let state = hidden;
const listeners = new Set<() => void>();
let cleanup: (() => void) | null = null;
function update(frame: Rect | null) {
  const next =
    frame && frame.height > 0
      ? Object.freeze({ visible: true, frame: Object.freeze(frame) })
      : hidden;
  if (
    state.visible === next.visible &&
    JSON.stringify(state.frame) === JSON.stringify(next.frame)
  )
    return;
  state = next;
  listeners.forEach((fn) => fn());
}
function attach() {
  const change = (e: KeyboardEvent) => {
    if (Platform.OS === "ios" && e.duration > 0)
      Keyboard.scheduleLayoutAnimation(e);
    update({
      x: e.endCoordinates.screenX,
      y: e.endCoordinates.screenY,
      width: e.endCoordinates.width,
      height: e.endCoordinates.height,
    });
  };
  const show = Keyboard.addListener(
    Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
    change,
  );
  const hide = Keyboard.addListener(
    Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
    () => update(null),
  );
  const initial = Keyboard.metrics();
  if (initial && Keyboard.isVisible())
    update({
      x: initial.screenX,
      y: initial.screenY,
      width: initial.width,
      height: initial.height,
    });
  else update(null);
  return () => {
    show.remove();
    hide.remove();
  };
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  if (!cleanup && Platform.OS !== "web") cleanup = attach();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      cleanup?.();
      cleanup = null;
      state = hidden;
    }
  };
};
export function useKeyboardFrame() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => hidden,
  );
}
