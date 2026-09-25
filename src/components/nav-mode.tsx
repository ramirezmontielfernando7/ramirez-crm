"use client";

import { createContext, useContext } from "react";
import { m } from "motion/react";
import { SPRING } from "@/components/motion";
import { BrandTile, type BrandingMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";
import type { NavMode } from "@/lib/preferences";

/**
 * 022 — El estado del menú lateral de escritorio, para quien no es el menú:
 * con el menú oculto, el logo para volver vive en el encabezado de cada
 * pantalla, en la fila de su título (no flotando en una esquina).
 */
type NavModeContext = { mode: NavMode; cycle: () => void; branding: BrandingMark };

const Ctx = createContext<NavModeContext | null>(null);

export function NavModeProvider({
  value,
  children,
}: {
  value: NavModeContext;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * El botón que reabre el menú oculto: el mismo logo que hace de botón en el
 * menú. Va ANTES del título de la pantalla, en su misma fila y alineado con el
 * texto. Fuera del estado oculto (o en el teléfono, que tiene su propia
 * barra) no se pinta.
 */
export function NavRevealButton({ className }: { className?: string }) {
  const nav = useContext(Ctx);
  if (!nav || nav.mode !== "hidden") return null;
  return (
    <m.button
      type="button"
      onClick={nav.cycle}
      aria-label="Mostrar el menú"
      title="Mostrar el menú"
      aria-expanded={false}
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={SPRING}
      className={cn(
        // 28 px: a la altura del título, sin estirar la fila.
        "-my-0.5 hidden h-7 w-7 shrink-0 rounded-[8px] transition-[filter] duration-150 hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:flex",
        className
      )}
    >
      <BrandTile branding={nav.branding} className="h-7 w-7 rounded-[8px] text-[13px]" />
    </m.button>
  );
}
