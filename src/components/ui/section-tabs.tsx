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

export function SectionTabs({ tabs, label }: { tabs: readonly SectionTab[]; label: string }) {
  const pathname = usePathname();
  const viewer = useViewer();
  return (
    <nav aria-label={label} className="-mb-px mt-2 flex gap-1 overflow-x-auto">
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
                "whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-sm transition-colors",
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
