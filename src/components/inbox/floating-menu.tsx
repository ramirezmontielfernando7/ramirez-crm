"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * 034 — Menú flotante de la Bandeja (cápsulas de la fila, menú contextual y
 * "⋯" del chat). Un solo comportamiento para todos:
 *
 *  - Va en un portal con `position: fixed`: la lista de chats tiene
 *    `overflow` y un menú absoluto dentro de una fila se recortaría.
 *  - Se ancla a un elemento (`DOMRect`) o a un punto (clic derecho, dedo) y
 *    se acomoda: si no cabe abajo se abre hacia arriba, y nunca se sale por
 *    los lados.
 *  - Se cierra al tocar FUERA (`pointerdown`: ratón, lápiz y dedo por igual,
 *    sin esperar al `click` que en touch llega tarde), con Escape, al
 *    redimensionar y cuando algo que lo contiene se desplaza.
 */

export type MenuAnchor =
  | { kind: "rect"; rect: DOMRect }
  | { kind: "point"; x: number; y: number };

const MARGIN = 8;
const SCROLL_GRACE_MS = 250;

export function FloatingMenu({
  anchor,
  onClose,
  label,
  className,
  children,
  triggerRef,
}: {
  anchor: MenuAnchor;
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
  /** El botón que lo abrió: un toque en él NO debe contar como "fuera". */
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Medir con el menú ya montado (oculto hasta tener sitio) para acomodarlo.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const a =
      anchor.kind === "rect"
        ? { left: anchor.rect.left, right: anchor.rect.right, top: anchor.rect.top, bottom: anchor.rect.bottom }
        : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    let left = anchor.kind === "rect" ? a.left : a.left;
    if (left + width > vw - MARGIN) left = Math.max(MARGIN, (anchor.kind === "rect" ? a.right : a.left) - width);
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - width - MARGIN));
    const gap = anchor.kind === "rect" ? 4 : 2;
    let top = a.bottom + gap;
    if (top + height > vh - MARGIN) top = Math.max(MARGIN, a.top - height - gap);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t)) return;
      if (triggerRef?.current?.contains(t)) return;
      onClose();
    };
    // El scroll DENTRO del menú (una lista larga de etiquetas) no lo cierra.
    // Tampoco el que llega justo al abrirlo: el navegador entrega el evento un
    // fotograma tarde, y el desplazamiento que lo causó (llevar la fila a la
    // vista antes del clic) fue ANTERIOR al menú. Uno posterior sí lo cierra.
    const openedAt = performance.now();
    const onScroll = (e: Event) => {
      if (box.current?.contains(e.target as Node)) return;
      if (performance.now() - openedAt < SCROLL_GRACE_MS) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        triggerRef?.current?.focus();
      }
    };
    // Capture: aunque la fila o un padre frene la propagación, se entera.
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    // Un scroll de la lista mueve la fila de debajo del menú: se cierra.
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose, triggerRef]);

  // El primer elemento enfocable recibe el foco: se usa con teclado.
  useEffect(() => {
    if (!pos) return;
    const first = box.current?.querySelector<HTMLElement>(
      "input, [role='menuitem']:not([disabled]), [role='option']:not([disabled]), button:not([disabled])"
    );
    first?.focus({ preventScroll: true });
  }, [pos]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={box}
      role="menu"
      aria-label={label}
      // Que un toque dentro del menú no llegue a la fila de abajo.
      onClick={(e) => e.stopPropagation()}
      // Los eventos de React suben por el portal hasta la fila: sin esto, tocar
      // el menú arrancaría la pulsación larga de la fila de abajo.
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      className={cn(
        "fixed z-50 max-h-[min(22rem,calc(100vh-1rem))] min-w-[10rem] max-w-[min(18rem,calc(100vw-1rem))] overflow-y-auto rounded-md border bg-popover p-1 text-foreground shadow-pop",
        className
      )}
    >
      {children}
    </div>,
    document.body
  );
}

/** Una opción de menú. `danger` la pinta en rojo (eliminar). */
export function MenuItem({
  children,
  onSelect,
  danger,
  disabled,
  title,
}: {
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={cn(
        "flex min-h-8 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        danger ? "text-danger-text hover:bg-danger-tint" : "text-foreground hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
