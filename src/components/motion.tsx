"use client";

import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * 022 — El movimiento de la app, en UN lugar: la sensación "de teléfono"
 * (resortes cortos, presión táctil) sin que cada pantalla invente su curva.
 *
 * - `motion` con `LazyMotion` + `m` (y `strict`): solo carga las funciones de
 *   animación del DOM (~5 KB), y un `motion.div` suelto que se colara
 *   cargaría el paquete entero — `strict` lo convierte en error.
 * - `reducedMotion="user"`: quien pidió menos movimiento en su sistema recibe
 *   cambios instantáneos (además de la regla global de `globals.css`).
 * - Nada pasa de 300 ms: el resorte se asienta en ~220 ms con un rebote leve.
 */

/** El resorte de la app: rápido, con un rebote apenas perceptible. */
export const SPRING = { type: "spring", duration: 0.22, bounce: 0.18 } as const;
/** Para lo que entra (filas de la línea de tiempo): sin rebote, más corto. */
export const ENTER = { type: "spring", duration: 0.18, bounce: 0 } as const;

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={SPRING}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

/**
 * Contenido que se expande y colapsa con resorte (altura `auto`, algo que CSS
 * solo no sabe animar). Sin `open` no está en el DOM: lo colapsado no se
 * tabula ni lo lee un lector de pantalla.
 */
export function Collapse({
  open,
  id,
  children,
  className,
}: {
  open: boolean;
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div
          id={id}
          key="content"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={SPRING}
          className={cn("overflow-hidden", className)}
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Un disparador de sección colapsable ("Más detalles", "Ver historial…"):
 * el texto, un chevron que gira con resorte y la presión táctil.
 */
export function DisclosureButton({
  open,
  onToggle,
  controls,
  children,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  controls?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-sm text-left transition-transform duration-150 active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <m.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING} className="shrink-0">
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
      </m.span>
    </button>
  );
}

/** Id estable para enlazar un disparador con lo que controla. */
export function useDisclosureId(prefix: string): string {
  return `${prefix}-${useId().replace(/:/g, "")}`;
}
