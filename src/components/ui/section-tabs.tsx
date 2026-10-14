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

export function SectionTabs({
  tabs,
  label,
  variant = "inline",
}: {
  tabs: readonly SectionTab[];
  label: string;
  /**
   * 039 — `bar`: la fila de pestañas de `PageShell`, de 40 px exactos (h-10)
   * con su borde abajo; `inline`: pestañas anidadas dentro de una pantalla.
   */
  variant?: "inline" | "bar";
}) {
  const pathname = usePathname();
  const viewer = useViewer();
  const bar = variant === "bar";
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex gap-1 overflow-x-auto",
        bar ? "h-10 shrink-0 items-stretch border-b px-2 sm:px-4 [scrollbar-width:none]" : "-mb-px mt-2"
      )}
    >
      {tabs
        .filter((t) => !t.permission || viewer.can(t.permission))
        .map((t) => {
          const active = t.match ? t.match(pathname) : pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 text-sm transition-colors",
                bar ? "flex items-center" : "pb-2 pt-1",
                active
                  ? "border-brand font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </Link>
          );
        })}
    </nav>
  );
}
