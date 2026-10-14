"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { NavMenuButton, NavRevealButton } from "@/components/nav-mode";
import { NAV_ICONS } from "@/components/nav-icons";
import { SectionTabs, type SectionTab } from "@/components/ui/section-tabs";
import { useViewer } from "@/components/viewer-context";
import { activeSection, availableSections, pillarOfPath } from "@/lib/modules/nav-layout";
import { moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { cn } from "@/lib/utils";

/**
 * 039 — El cascarón de TODAS las pantallas de la app: misma geometría en
 * Bandeja, CRM Comercial, Estudio de IA, Marketing, Inteligencia y Ajustes.
 *
 * - Encabezado de 56 px exactos (h-14), la misma altura que la fila del logo
 *   del menú: a la izquierda el botón del menú (cajón en el teléfono; el que
 *   reabre el menú oculto en escritorio), el ícono del pilar y el título; a la
 *   derecha, las acciones primarias (botones de 36 px, h-9).
 * - Debajo, si hay pestañas, una fila de 40 px exactos (h-10) con su borde.
 *   Con `pillar`, son las pestañas del pilar que esta persona puede abrir
 *   (módulo encendido + permiso; el servidor valida igual en cada ruta).
 * - `fluid`: el contenido ocupa todo lo que queda y maneja su propio scroll
 *   (Bandeja, Kanban, editor dividido). `contained`: columna centrada de
 *   `max-w-6xl` con scroll (tablas, formularios, métricas).
 */
export type PageShellVariant = "fluid" | "contained";

export function PageShell({
  title,
  icon,
  subtitle,
  badge,
  back,
  actions,
  pillar,
  hideSections,
  tabs,
  tabsLabel,
  variant = "contained",
  className,
  children,
}: {
  /** Sin título, el del pilar de la ruta. */
  title?: React.ReactNode;
  /** Sin ícono, el del pilar. `null` = sin ícono. */
  icon?: LucideIcon | null;
  /** Una línea discreta junto al título (se recorta; nunca agranda el encabezado). */
  subtitle?: React.ReactNode;
  /** Junto al título, siempre visible (p. ej. el estado de una campaña). */
  badge?: React.ReactNode;
  /** Pantalla de detalle: flecha para volver, antes del título. */
  back?: { href: string; label: string };
  /** Acciones primarias, a la derecha (botones h-9). */
  actions?: React.ReactNode;
  /**
   * El pilar del menú al que pertenece la pantalla: pone sus pestañas. Sin
   * él, se deduce de la ruta (`pillarOfPath`); `false` = sin pestañas de pilar.
   */
  pillar?: ModuleKey | false;
  /** Rutas de pestañas del pilar que esta pantalla no muestra (p. ej. sin KB_DOCS). */
  hideSections?: readonly string[];
  /** Pestañas propias (en vez de las del pilar). */
  tabs?: readonly SectionTab[];
  tabsLabel?: string;
  variant?: PageShellVariant;
  /** Clases extra del área de contenido. */
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const viewer = useViewer();
  const def = useMemo(() => {
    if (pillar === false) return undefined;
    if (pillar) return moduleDef(pillar);
    return pillarOfPath(pathname);
  }, [pillar, pathname]);

  const pillarTabs = useMemo<SectionTab[] | null>(() => {
    if (!def?.sections) return null;
    const sections = availableSections(def, { has: viewer.hasModule }, viewer.can).filter(
      (s) => !hideSections?.includes(s.route)
    );
    return sections.map((s) => ({
      href: s.route,
      label: s.label,
      match: (p: string) => activeSection(sections, p) === s,
    }));
  }, [def, viewer, hideSections]);

  const shownTabs = tabs ?? pillarTabs;
  const Icon = icon === null ? null : (icon ?? (def ? NAV_ICONS[def.icon] : null));
  const heading = title ?? def?.label ?? "";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header
        data-page-header
        className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 sm:px-6"
      >
        <div className="flex min-w-0 items-center gap-2">
          <NavMenuButton />
          <NavRevealButton />
          {back && (
            <Link
              href={back.href}
              aria-label={back.label}
              title={back.label}
              className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          {!back && Icon && <Icon aria-hidden className="h-[18px] w-[18px] shrink-0 text-brand" strokeWidth={1.8} />}
          <h1 className="truncate text-[16px] font-semibold tracking-tight text-foreground">{heading}</h1>
          {badge}
          {subtitle && (
            <p className="hidden min-w-0 truncate text-xs text-text-3 md:block" data-page-subtitle>
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2 [&>a>button]:h-9 [&>button]:h-9">{actions}</div>}
      </header>
      {shownTabs && shownTabs.length > 0 && (
        <SectionTabs tabs={shownTabs} label={tabsLabel ?? `Secciones de ${typeof heading === "string" ? heading : "la pantalla"}`} variant="bar" />
      )}
      {variant === "fluid" ? (
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>{children}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className={cn("mx-auto w-full max-w-6xl px-4 py-6 sm:px-6", className)}>{children}</div>
        </div>
      )}
    </div>
  );
}
