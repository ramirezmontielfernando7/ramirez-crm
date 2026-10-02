"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings2 } from "lucide-react";
import { NavRevealButton } from "@/components/nav-mode";
import { cn } from "@/lib/utils";
import { useViewer } from "@/components/viewer-context";
import type { Permission } from "@/lib/auth/permissions";

/**
 * Campañas v2 — Encabezado de Campañas con sus pestañas (Campañas,
 * Audiencias, Métricas y, desde el PR 4, Plantillas) y el acceso a Ajustes de
 * envío. Las pestañas son
 * rutas: el enlace a una pestaña se puede compartir y el botón Atrás funciona.
 */
const TABS = [
  { href: "/campaigns", label: "Campañas" },
  { href: "/campaigns/audiences", label: "Audiencias" },
  { href: "/campaigns/metrics", label: "Métricas" },
  // 030 (PR 4): antes en Ajustes → Plantillas (que ahora redirige aquí).
  { href: "/campaigns/templates", label: "Plantillas", permission: "templates.manage" },
] as const satisfies readonly { href: string; label: string; permission?: Permission }[];

export function CampaignsTabs({ actions }: { actions?: React.ReactNode }) {
  const pathname = usePathname();
  const viewer = useViewer();
  return (
    <header className="border-b px-4 pt-3 sm:px-6 sm:pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <NavRevealButton />
          <h2 className="text-[17px] font-bold tracking-tight">Campañas</h2>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <Link
            href="/campaigns/settings"
            aria-label="Ajustes de envío"
            title="Ajustes de envío"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings2 className="h-4 w-4" strokeWidth={1.8} />
          </Link>
        </div>
      </div>
      <nav aria-label="Secciones de Campañas" className="-mb-px mt-2 flex gap-1 overflow-x-auto">
        {TABS.filter((t) => !("permission" in t) || viewer.can(t.permission)).map((t) => {
          const active = pathname === t.href;
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
    </header>
  );
}
