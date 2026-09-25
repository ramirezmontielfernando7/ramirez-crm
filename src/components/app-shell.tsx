"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, m } from "motion/react";
import { Menu } from "lucide-react";
import type { Branding } from "@/lib/branding";
import type { ThemePreference } from "@/lib/theme";
import type { ResolvedCommit } from "@/lib/version";
import { AppNav } from "@/components/app-nav";
import { BrandLogo } from "@/components/brand-mark";
import { cn } from "@/lib/utils";
import { ViewerProvider } from "@/components/viewer-context";
import { MotionProvider, SPRING } from "@/components/motion";
import { nextNavMode, type NavMode } from "@/lib/preferences";

/**
 * Cascarón de la app en dos modos:
 *
 * - Escritorio (lg+): el panel lateral es una columna fija, como siempre.
 * - Móvil/tableta: el lateral sale de la izquierda como cajón sobre un velo,
 *   y arriba queda una barra azul marino con el hamburguesa y la marca. El
 *   cajón se cierra solo al navegar (el `pathname` cambia) y con Escape.
 *
 * La altura usa `100dvh` (no `100vh`) porque en el navegador móvil la barra de
 * direcciones se encoge al hacer scroll: con `vh` el compositor de la Bandeja
 * queda debajo del borde visible.
 */
export function AppShell({
  branding,
  userName,
  role,
  userId,
  theme,
  commit,
  agenda = false,
  campaigns = false,
  navMode = "expanded",
  children,
}: {
  branding: Branding;
  userName: string;
  role: string;
  /** 020 — para el contexto del que mira (rol y permisos en pantalla). */
  userId: string;
  theme: ThemePreference;
  /** Commit resuelto en el servidor, con su procedencia (ver `resolveCommit`). */
  commit?: ResolvedCommit;
  /** 015 — ¿esta instancia tiene agenda? Lo decide el servidor. */
  agenda?: boolean;
  /** 021 — ¿esta instancia tiene Campañas? Lo decide el servidor (CAMPAIGNS). */
  campaigns?: boolean;
  /**
   * 022 — En qué estado arranca la barra lateral en escritorio (expandida,
   * solo íconos u oculta). Lo resuelve el servidor: la preferencia guardada
   * del usuario o, sin ella, el default de su rol. Así el primer pintado ya
   * llega en su estado, sin parpadeo.
   */
  navMode?: NavMode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [mode, setMode] = useState<NavMode>(navMode);

  // El hamburguesa de escritorio recorre el ciclo expandido → íconos →
  // oculto → expandido. (El teléfono no lo usa: ahí el cajón abre y cierra.)
  function cycleNav() {
    const next = nextNavMode(mode);
    setMode(next);
    // Por usuario y en BD: la elección lo sigue a otro dispositivo. Si no se
    // guarda, la barra igual cambia; solo no se recordará la próxima vez.
    void fetch("/api/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ navMode: next }),
    }).catch(() => undefined);
  }

  // Navegar = cerrar el cajón. Sin esto, tocar "Pipeline" deja el velo encima
  // de la pantalla recién cargada.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <ViewerProvider userId={userId} role={role}>
      <MotionProvider>
        <div className="flex h-dvh overflow-hidden bg-background">
          {navOpen && (
            <button
              aria-label="Cerrar el menú"
              tabIndex={-1}
              onClick={() => setNavOpen(false)}
              className="fixed inset-0 z-40 bg-overlay lg:hidden"
            />
          )}

          <AppNav
            branding={branding}
            commit={commit}
            userName={userName}
            role={role}
            theme={theme}
            agenda={agenda}
            campaigns={campaigns}
            open={navOpen}
            onClose={() => setNavOpen(false)}
            mode={mode}
            onCycleMode={cycleNav}
          />

          {/* 022 — Menú oculto (solo escritorio): el hamburguesa queda fijo en
              la esquina, sin depender de hover, en una franja angosta sin
              borde para no tapar el título de la pantalla. */}
          <AnimatePresence initial={false}>
            {mode === "hidden" && (
              <m.button
                key="nav-reveal"
                onClick={cycleNav}
                aria-label="Mostrar el menú"
                title="Mostrar el menú"
                aria-expanded={false}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.1 } }}
                transition={SPRING}
                className="fixed left-1.5 top-[18px] z-30 hidden h-8 w-8 items-center justify-center rounded-md text-text-3 transition-[color,background-color] duration-150 hover:bg-accent hover:text-foreground active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex"
              >
                <Menu className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </m.button>
            )}
          </AnimatePresence>

          <div className={cn("flex min-w-0 flex-1 flex-col", mode === "hidden" && "lg:pl-11")}>
            {/* Misma pieza que la barra lateral (`nav-dark`): en el teléfono la
                franja azul marino de arriba es lo que queda del bicolor. */}
            <header className="nav-dark flex h-12 shrink-0 items-center gap-1.5 border-b bg-subtle px-2 text-foreground lg:hidden">
              <button
                onClick={() => setNavOpen(true)}
                aria-label="Abrir el menú"
                aria-expanded={navOpen}
                className="rounded-md p-2 text-text-2 hover:bg-accent hover:text-foreground"
              >
                <Menu className="h-5 w-5" strokeWidth={1.8} />
              </button>
              <BrandLogo branding={branding} className="min-w-0" />
            </header>

            <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
          </div>
        </div>
      </MotionProvider>
    </ViewerProvider>
  );
}
