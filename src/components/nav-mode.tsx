"use client";

import { createContext, useContext } from "react";
import { m } from "motion/react";
import { Menu } from "lucide-react";
import { SPRING } from "@/components/motion";
import { cn } from "@/lib/utils";
import type { NavMode } from "@/lib/preferences";

/**
 * 022 — El estado del menú lateral de escritorio, para quien no es el menú:
 * con el menú oculto, el hamburguesa para volver vive en el encabezado de
 * cada pantalla, en la fila de su título (no flotando en una esquina).
 */
type NavModeContext = { mode: NavMode; cycle: () => void };

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
 * El hamburguesa que reabre el menú oculto. Va ANTES del título de la
 * pantalla, en su misma fila y alineado con el texto. Fuera del estado
 * oculto (o en el teléfono, que tiene su propia barra) no se pinta.
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
        // -ml-1.5: el trazo del ícono (no la caja del botón) queda alineado
        // con el borde del contenido de abajo (buscador, filas).
        "-my-1 -ml-1.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-3 transition-[color,background-color] duration-150 hover:bg-accent hover:text-foreground active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex",
        className
      )}
    >
      <Menu className="h-[18px] w-[18px]" strokeWidth={1.8} />
    </m.button>
  );
}
