"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { NavRevealButton } from "@/components/nav-mode";
import { NAV_ICONS } from "@/components/nav-icons";
import { SectionTabs, type SectionTab } from "@/components/ui/section-tabs";
import { useViewer } from "@/components/viewer-context";
import { activeSection, availableSections, pillarOfPath } from "@/lib/modules/nav-layout";
import { moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { cn } from "@/lib/utils";

/**
 * 039 — El cascarón de las pantallas de los pilares (CRM Comercial, Estudio
 * de IA, Marketing, Inteligencia), Ajustes y Plataforma. La Bandeja y el Chat
 * de equipo NO lo usan: conservan sus columnas a altura completa y cambian
 * entre sí con las pestañas Empresa · Equipo (`InboxTabs`).
 *
 * UNA sola barra de 56 px (h-14), alineada con la fila del logo del menú:
 * - izquierda: el botón que reabre el menú oculto, ícono y título del pilar;
 * - tras un divisor vertical, las pestañas del pilar en píldora (la activa
 *   como el renglón del menú lateral), a la misma altura;
 * - derecha: las acciones primarias (botones h-8/h-9).
 * En el teléfono, si no caben, las pestañas bajan a una tira compacta con
 * scroll horizontal; en escritorio nunca hay una segunda barra.
 *
 * El contenedor es el panel flotante de `AppShell` (radio, borde y sombra):
 * aquí no se pinta fondo propio para no taparlo.
 * - `fluid`: el contenido ocupa todo lo que queda y maneja su propio scroll
 *   (Kanban, editores). `contained`: columna centrada de `max-w-6xl` con
 *   scroll (tablas, formularios, métricas).
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

  const tabsNav =
    shownTabs && shownTabs.length > 0 ? (
      <SectionTabs
        tabs={shownTabs}
        label={tabsLabel ?? `Secciones de ${typeof heading === "string" ? heading : "la pantalla"}`}
        variant="pill"
      />
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        data-page-header
        className="flex shrink-0 flex-wrap items-center border-b px-4 sm:h-14 sm:flex-nowrap sm:px-6"
      >
        <div className="flex h-14 min-w-0 flex-auto items-center gap-2 sm:h-auto sm:flex-none">
          <NavRevealButton />
          {back && (
            <Link
              href={back.href}
              aria-label={back.label}
              title={back.label}
              className="-ml-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          {!back && Icon && <Icon aria-hidden className="h-[17px] w-[17px] shrink-0 text-brand" strokeWidth={1.8} />}
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-foreground">{heading}</h1>
          {badge}
          {subtitle && (
            <p className="hidden min-w-0 truncate text-xs text-text-3 xl:block" data-page-subtitle>
              {subtitle}
            </p>
          )}
        </div>
        {tabsNav && (
          <>
            <span aria-hidden className="mx-3 hidden h-4 w-px shrink-0 bg-border sm:block" />
            {/* Teléfono: tira compacta debajo (scroll horizontal). Desde sm: en la misma fila. */}
            <div className="order-last -mx-4 flex h-11 shrink-0 min-w-0 grow basis-[calc(100%+2rem)] items-center border-t px-3 sm:order-none sm:mx-0 sm:h-auto sm:shrink sm:basis-0 sm:border-t-0 sm:px-0">
              {tabsNav}
            </div>
          </>
        )}
        {actions && (
          <div className="ml-auto flex shrink-0 items-center gap-2 pl-3 [&>a>button]:h-8 [&>button]:h-8">{actions}</div>
        )}
      </header>
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
