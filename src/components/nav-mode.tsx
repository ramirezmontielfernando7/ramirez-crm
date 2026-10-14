"use client";

import { createContext, useContext } from "react";
import { m } from "motion/react";
import { NAV } from "@/components/motion";
import { BrandTile, type BrandingMark } from "@/components/brand-mark";
import { TeamUnreadLogoBadge } from "@/components/team-chat/unread-badge";
import { cn } from "@/lib/utils";
import type { NavMode } from "@/lib/preferences";

/**
 * 022 — El estado del menú lateral de escritorio, para quien no es el menú:
 * con el menú oculto, el logo para volver vive en el encabezado de cada
 * pantalla, en la fila de su título (no flotando en una esquina).
 */
type NavModeContext = {
  mode: NavMode;
  cycle: () => void;
  branding: BrandingMark;
  /** 039 — Abre el cajón del menú en el teléfono (el botón vive en `PageShell`). */
  openDrawer?: () => void;
  /** ¿Está abierto el cajón? (para `aria-expanded`). */
  drawerOpen?: boolean;
};

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
      // La misma duración que el resto del cambio de estado del menú.
      transition={NAV}
      className={cn(
        // El MISMO logo y lugar que en el menú (32 px, a 12 px del borde y a
        // la altura del título): el clic siguiente cae donde cayó el anterior.
        // -my-1 para no estirar la fila; -ml-1 porque el encabezado tiene 16.
        "relative -my-1 -ml-1 hidden h-8 w-8 shrink-0 rounded-[9px] transition-[background-color,transform] duration-150 hover:bg-accent active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:flex",
        className
      )}
    >
      {/* Invertido: la burbuja en teal sobre el encabezado blanco, sin el
          bloque de color del mosaico. */}
      <BrandTile branding={nav.branding} ghost className="h-8 w-8 rounded-[9px] text-[15px]" />
      {/* 025 — Menú oculto: el globo del chat de equipo va en el botón que lo reabre. */}
      <TeamUnreadLogoBadge />
    </m.button>
  );
}

/**
 * 039 — El botón del menú en el teléfono y la tableta: el logo de la marca,
 * a la izquierda del título de cada pantalla (`PageShell`). Abre el cajón del
 * menú. En escritorio no se pinta: ahí el menú es una columna fija.
 */
export function NavMenuButton({ className }: { className?: string }) {
  const nav = useContext(Ctx);
  if (!nav?.openDrawer) return null;
  return (
    <button
      type="button"
      onClick={nav.openDrawer}
      aria-label="Abrir el menú"
      aria-expanded={nav.drawerOpen ?? false}
      className={cn(
        "relative -ml-1 shrink-0 rounded-[9px] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden",
        className
      )}
    >
      <BrandTile branding={nav.branding} className="h-8 w-8 rounded-[9px] text-[15px]" />
      {/* 025 — En el teléfono el menú se abre desde aquí: el globo del chat va encima. */}
      <TeamUnreadLogoBadge />
    </button>
  );
}
