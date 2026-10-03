"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { Branding } from "@/lib/branding";
import type { ThemePreference } from "@/lib/theme";
import type { ResolvedCommit } from "@/lib/version";
import { AppNav } from "@/components/app-nav";
import { cn } from "@/lib/utils";
import { BrandLogo, BrandTile } from "@/components/brand-mark";
import { ViewerProvider } from "@/components/viewer-context";
import { TeamUnreadLogoBadge } from "@/components/team-chat/unread-badge";
import { HandoffNotices } from "@/components/handoff-notices";
import { NumberHealthBanner } from "@/components/number-health";
import { CampaignPauseBanner } from "@/components/campaigns/campaign-pause-banner";
import { MotionProvider, NAV } from "@/components/motion";
import { NavModeProvider } from "@/components/nav-mode";
import { nextNavMode, type NavMode } from "@/lib/preferences";
import type { Permission } from "@/lib/auth/permissions";
import type { ModuleKey } from "@/lib/modules/registry";
import type { NavEntries } from "@/lib/modules/nav-layout";

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
  campaigns = false,
  platform = false,
  nav,
  modules,
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
  /** 021 — ¿esta organización tiene Campañas? (avisos de salud y pausa). */
  campaigns?: boolean;
  /**
   * 030 (PR 4) — El menú ya resuelto en el servidor (módulos, permisos y el
   * menú del rol) y los módulos encendidos de la organización.
   */
  nav?: NavEntries;
  modules?: readonly ModuleKey[];
  /** Fase 3 — ¿quien mira es administrador de plataforma? Lo decide el servidor. */
  platform?: boolean;
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
    <ViewerProvider userId={userId} role={role} grants={grants} modules={modules}>
      <MotionProvider>
        <ShellFrame
          branding={branding}
          userName={userName}
          role={role}
          theme={theme}
          commit={commit}
          campaigns={campaigns}
          platform={platform}
          nav={nav}
          navMode={navMode}
        >
          {children}
        </ShellFrame>
        {/* 026 — Avisos de handoff (solo le llegan a quien le toca). */}
        <HandoffNotices />
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
  campaigns,
  platform,
  nav,
  navMode,
  children,
}: {
  branding: Branding;
  userName: string;
  role: string;
  theme: ThemePreference;
  commit?: ResolvedCommit;
  campaigns: boolean;
  platform: boolean;
  nav?: NavEntries;
  navMode: NavMode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [mode, setMode] = useState<NavMode>(navMode);
  const content = useRef<HTMLDivElement>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  }, []);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const navCtx = useMemo(() => ({ mode, cycle: cycleNav, branding }), [mode, cycleNav, branding]);

  // El lugar del menú (el separador) cambia de golpe; el menú anima su ancho
  // por CSS (AppNav) y la columna de contenido ENTERA se desliza pegada a su
  // borde: antes de pintar se la deja donde estaba (el desplazamiento =
  // cuánto se corrió su borde izquierdo) y se suelta con una transición CSS
  // de `transform` con el MISMO tiempo y curva (`duration-nav` +
  // `ease-panel`). Las dos transiciones arrancan en el mismo cálculo de
  // estilos, así que van juntas cuadro a cuadro (con la animación de motion
  // arrancaban con un cuadro de diferencia y se veía un salto inicial).
  useLayoutEffect(() => {
    const el = content.current;
    const before = leftBefore.current;
    leftBefore.current = null;
    if (!el || before === null) return;
    const delta = before - el.getBoundingClientRect().left;
    if (Math.abs(delta) < 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.style.transition = "none";
    el.style.transform = `translateX(${delta}px)`;
    void el.offsetWidth; // fija el punto de partida antes de soltarla
    el.style.transition = `transform ${NAV.duration * 1000}ms cubic-bezier(${NAV.ease.join(", ")})`;
    el.style.transform = "translateX(0px)";
    // Al terminar se quita el `transform`: si se quedara, los `fixed` de
    // adentro (cajones, velos) se posicionarían contra la columna.
    if (slideTimer.current) clearTimeout(slideTimer.current);
    slideTimer.current = setTimeout(() => {
      el.style.transition = "";
      el.style.transform = "";
    }, NAV.duration * 1000 + 40);
  }, [mode]);

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
      {/* Fondo base de la página; en escritorio, la barra y el contenido son
          dos paneles que flotan sobre él (radio + sombra), separados. */}
      <div className="relative flex h-dvh overflow-hidden bg-base lg:p-3">
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
          nav={nav}
          platform={platform}
          open={navOpen}
          onClose={closeNav}
          mode={mode}
          onCycleMode={cycleNav}
        />

        {/* Escritorio: reserva el lugar del menú (que flota encima, ver
            AppNav) y su hueco de 12 px. Cambia de golpe; lo que se mueve es
            el menú y la columna de contenido. */}
        <div
          aria-hidden
          className={cn(
            "hidden shrink-0 lg:block",
            mode === "expanded" ? "lg:mr-3 lg:w-56" : mode === "collapsed" ? "lg:mr-3 lg:w-14" : "lg:w-0"
          )}
        />

        {/* 022 — Con el menú oculto, el hamburguesa para volver va en la fila
            del título de cada pantalla (`NavRevealButton`), así que la
            columna ocupa TODO el ancho, sin franja ni botón flotante. */}
        <div
          ref={content}
          className="shell-content flex min-w-0 flex-1 flex-col overflow-hidden bg-surface lg:rounded-panel lg:border lg:shadow-panel"
        >
          {/* Misma pieza que la barra lateral (`nav-dark`): en el teléfono la
              franja azul marino de arriba es lo que queda del bicolor. */}
          <header className="nav-dark flex h-14 shrink-0 items-center gap-2.5 border-b bg-nav px-2 text-foreground lg:hidden">
            {/* El logo abre el cajón, como el de la barra lateral en escritorio. */}
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Abrir el menú"
              aria-expanded={navOpen}
              className="relative ml-1 shrink-0 rounded-[9px] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BrandTile branding={branding} className="h-8 w-8 rounded-[9px] text-[15px]" />
              {/* 025 — En el teléfono el menú se abre desde aquí: el globo del chat va encima. */}
              <TeamUnreadLogoBadge />
            </button>
            <BrandLogo branding={branding} tile={false} className="min-w-0" />
          </header>

          {/* Campañas v2: aviso de salud del número (Propietario y Coordinador). */}
          <NumberHealthBanner campaigns={campaigns} />
          {/* Campañas v2: pausa de seguridad automática (Propietario y Coordinador). */}
          <CampaignPauseBanner campaigns={campaigns} />
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </NavModeProvider>
  );
}
