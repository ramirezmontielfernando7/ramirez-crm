"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * 034 — Menú contextual de una fila, igual en escritorio y en touch.
 *
 *  - Escritorio: el evento `contextmenu` (clic derecho, o la tecla de menú).
 *  - Touch: pulsación larga (500 ms). Se cancela si el dedo se mueve más de
 *    `MOVE_TOLERANCE` px (es un scroll) o se levanta antes. Android Chrome
 *    además dispara `contextmenu` por su cuenta: ambos caminos llaman a la
 *    misma `open`, que es idempotente.
 *  - Tras una pulsación larga se traga el `click` que sigue, para que abrir
 *    el menú no abra también el chat.
 *
 * Para frenar el menú nativo del sistema (iOS/Android) la fila lleva
 * `touch-callout: none` y `user-select: none` (ver `longPressStyle`).
 */

export const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 8;

export const longPressClass =
  "select-none [-webkit-touch-callout:none] [-webkit-user-select:none]";

export function useLongPress(open: (x: number, y: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      // El ratón usa clic derecho; esto es solo para dedo y lápiz.
      if (e.pointerType === "mouse") return;
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      cancel();
      origin.current = { x: e.clientX, y: e.clientY };
      const { clientX: x, clientY: y } = e;
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        // Un toque largo suele traer una vibración corta donde existe.
        if (typeof navigator !== "undefined") navigator.vibrate?.(10);
        openRef.current(x, y);
        // Si el `click` nunca llega, no se queda tragando el siguiente.
        setTimeout(() => (fired.current = false), 600);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const o = origin.current;
      if (!o) return;
      if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_TOLERANCE) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      cancel();
      openRef.current(e.clientX, e.clientY);
    },
    /** En fase de captura: si hubo pulsación larga, el clic no pasa a la fila. */
    onClickCapture: (e: React.MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
