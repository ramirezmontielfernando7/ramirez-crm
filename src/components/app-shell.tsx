"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAnimate } from "motion/react";
import type { Branding } from "@/lib/branding";
import type { ThemePreference } from "@/lib/theme";
import type { ResolvedCommit } from "@/lib/version";
import { AppNav } from "@/components/app-nav";
import { BrandLogo, BrandTile } from "@/components/brand-mark";
import { ViewerProvider } from "@/components/viewer-context";
import { MotionProvider, NAV } from "@/components/motion";
import { NavModeProvider } from "@/components/nav-mode";
import { nextNavMode, type NavMode } from "@/lib/preferences";
import type { Permission } from "@/lib/auth/permissions";

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
  grants,
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
  /** 025 — delegaciones de la organización, para lo que se pinta. */
  grants?: readonly Permission[];
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
  // Los proveedores van POR ENCIMA del estado del menú: si vivieran dentro de
  // `ShellFrame`, cada cambio de estado del menú los volvería a renderizar, y
  // `LazyMotion` arrastra con él a cada `m.*` de la pantalla (ver
  // `MotionProvider`). Medido: 60 filas de la Bandeja por clic.
  return (
    <ViewerProvider userId={userId} role={role} grants={grants}>
      <MotionProvider>
        <ShellFrame
          branding={branding}
          userName={userName}
          role={role}
          theme={theme}
          commit={commit}
          agenda={agenda}
          campaigns={campaigns}
          navMode={navMode}
        >
          {children}
        </ShellFrame>
      </MotionProvider>
    </ViewerProvider>
  );
}

function ShellFrame({
  branding,
  userName,
  role,
  theme,
  commit,
  agenda,
  campaigns,
  navMode,
  children,
}: {
  branding: Branding;
  userName: string;
  role: string;
  theme: ThemePreference;
  commit?: ResolvedCommit;
  agenda: boolean;
  campaigns: boolean;
  navMode: NavMode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [mode, setMode] = useState<NavMode>(navMode);
  const [content, animate] = useAnimate<HTMLDivElement>();
  // Dónde empezaba el contenido antes de cambiar el menú (para deslizarlo).
  const leftBefore = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El hamburguesa de escritorio recorre el ciclo expandido → íconos →
  // oculto → expandido. (El teléfono no lo usa: ahí el cajón abre y cierra.)
  // Estable (lee el modo de un ref): así el contexto del menú y `AppNav` no
  // cambian de identidad por culpa de la función.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const cycleNav = useCallback(() => {
    const next = nextNavMode(modeRef.current);
    leftBefore.current = content.current?.getBoundingClientRect().left ?? null;
    setMode(next);
    // Por usuario y en BD: la elección lo sigue a otro dispositivo. Si no se
    // guarda, la barra igual cambia; solo no se recordará la próxima vez.
    // Con clics seguidos se guarda solo el ÚLTIMO estado: tres PUT en vuelo
    // pueden llegar en desorden y dejar guardado uno viejo.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void fetch("/api/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ navMode: next }),
      }).catch(() => undefined);
    }, 300);
  }, [content]);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const navCtx = useMemo(() => ({ mode, cycle: cycleNav, branding }), [mode, cycleNav, branding]);

  // El menú cambia de ancho de golpe (animar `width` recalcula el layout en
  // cada cuadro). Lo que se mueve es la columna de contenido ENTERA, como una
  // sola pieza: antes de pintar se la deja donde estaba (el desplazamiento = cuánto se
  // corrió su borde izquierdo) y se desliza a su lugar. Solo `transform`.
  useLayoutEffect(() => {
    const el = content.current;
    const before = leftBefore.current;
    leftBefore.current = null;
    if (!el || before === null) return;
    const delta = before - el.getBoundingClientRect().left;
    if (Math.abs(delta) < 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // `transform` como cadena (no `x`): motion la entrega a WAAPI y corre en el
    // compositor. Con `x` el resorte se calcula en el hilo principal cuadro a
    // cuadro, justo cuando React y el pintado de la barra lo tienen ocupado.
    void animate(el, { transform: [`translateX(${delta}px)`, "translateX(0px)"] }, NAV);
  }, [mode, animate, content]);

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
    <NavModeProvider value={navCtx}>
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
          onClose={closeNav}
          mode={mode}
          onCycleMode={cycleNav}
        />

        {/* 022 — Con el menú oculto, el hamburguesa para volver va en la fila
            del título de cada pantalla (`NavRevealButton`), así que la
            columna ocupa TODO el ancho, sin franja ni botón flotante. */}
        <div ref={content} className="flex min-w-0 flex-1 flex-col">
          {/* Misma pieza que la barra lateral (`nav-dark`): en el teléfono la
              franja azul marino de arriba es lo que queda del bicolor. */}
          <header className="nav-dark flex h-14 shrink-0 items-center gap-2.5 border-b bg-subtle px-2 text-foreground lg:hidden">
            {/* El logo abre el cajón, como el de la barra lateral en escritorio. */}
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Abrir el menú"
              aria-expanded={navOpen}
              className="ml-1 shrink-0 rounded-[9px] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BrandTile branding={branding} className="h-8 w-8 rounded-[9px] text-[15px]" />
            </button>
            <BrandLogo branding={branding} tile={false} className="min-w-0" />
          </header>

          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </NavModeProvider>
  );
}
