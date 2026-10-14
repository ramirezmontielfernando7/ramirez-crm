"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useViewer } from "@/components/viewer-context";
import type { Permission } from "@/lib/auth/permissions";

/**
 * 031 (A2) — Subpestañas de una sección (Campañas, Laboratorio…), extraídas
 * de `CampaignsTabs`. Son rutas: el enlace se comparte y Atrás funciona.
 * `permission` oculta la pestaña a quien no puede (el servidor lo valida
 * igual); `match` deja que una pestaña siga activa en sus rutas hijas.
 */
export type SectionTab = {
  href: string;
  label: string;
  permission?: Permission;
  match?: (pathname: string) => boolean;
};

/** 039 — Cómo se pinta cada pestaña según la variante. */
const TAB_CLASS = {
  inline: (active: boolean) =>
    cn(
      "whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-sm transition-colors",
      active ? "border-brand font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
    ),
  // Dentro de la fila de 56 px de `PageShell`: píldora como el renglón del menú lateral.
  pill: (active: boolean) =>
    cn(
      "flex shrink-0 items-center whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active ? "bg-brand-tint text-brand-text" : "text-text-2 hover:bg-accent hover:text-foreground"
    ),
  // Sub-secciones dentro del contenido (Ajustes, Tareas y notas): control segmentado.
  segmented: (active: boolean) =>
    cn(
      "flex shrink-0 items-center whitespace-nowrap rounded-[7px] px-3 py-1 text-[13px] font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active ? "bg-card text-foreground shadow-sm" : "text-text-2 hover:text-foreground"
    ),
} as const;

const NAV_CLASS = {
  inline: "-mb-px mt-2 flex gap-1 overflow-x-auto",
  pill: "flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]",
  segmented: "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md bg-muted p-[3px] [scrollbar-width:none]",
} as const;

export type SectionTabsVariant = keyof typeof TAB_CLASS;

export function SectionTabs({
  tabs,
  label,
  variant = "inline",
  className,
}: {
  tabs: readonly SectionTab[];
  label: string;
  /**
   * `inline`: pestañas anidadas con subrayado. 039 — `pill`: las del pilar,
   * dentro de la fila de 56 px de `PageShell`; `segmented`: sub-secciones
   * dentro del contenido (nunca una segunda barra bajo el encabezado).
   */
  variant?: SectionTabsVariant;
  className?: string;
}) {
  const pathname = usePathname();
  const viewer = useViewer();
  return (
    <nav aria-label={label} className={cn(NAV_CLASS[variant], className)}>
      {tabs
        .filter((t) => !t.permission || viewer.can(t.permission))
        .map((t) => {
          const active = t.match ? t.match(pathname) : pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={TAB_CLASS[variant](active)}
            >
              {t.label}
            </Link>
          );
        })}
    </nav>
  );
}
