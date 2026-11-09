"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItemOf } from "@/components/app-nav";
import { useInboxUnread } from "@/components/inbox/unread-store";
import { useTeamUnread } from "@/components/team-chat/unread-store";
import { useViewer } from "@/components/viewer-context";
import { pathWithin, type NavEntries } from "@/lib/modules/nav-layout";
import type { ModuleKey } from "@/lib/modules/registry";

/** Cuántos pilares caben abajo; el resto vive en «Más». */
export const MOBILE_TAB_COUNT = 4;

/** Nombres cortos para que quepan cinco pestañas en 360 px. */
const SHORT: Partial<Record<ModuleKey, string>> = {
  pipeline: "CRM",
  lab: "Estudio IA",
};

const count = (n: number) => (n > 99 ? "99+" : String(n));

/**
 * Barra de pestañas del teléfono (app móvil, maqueta B): los primeros
 * pilares del menú y «Más», que abre su pantalla. Solo bajo `lg`. Se esconde
 * con un chat abierto (`html[data-chat-open]`) para dejar el compositor libre.
 * La pestaña activa lleva su píldora de color, como WhatsApp.
 */
export function MobileTabBar({
  nav,
  moreOpen = false,
  onMore,
  onNavigate,
}: {
  nav?: NavEntries;
  moreOpen?: boolean;
  onMore: () => void;
  /** Tocar una pestaña cierra «Más» aunque la ruta no cambie. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const unread = useInboxUnread();
  const viewer = useViewer();
  const teamUnread = useTeamUnread(viewer.userId);
  const keys = (nav?.keys ?? ["inbox", "pipeline"]).slice(0, MOBILE_TAB_COUNT);
  const items = keys.map((k) => ({ key: k, ...navItemOf(k, nav?.hrefs?.[k]) }));
  // Al tocar una pestaña se marca AL INSTANTE, como en WhatsApp, sin esperar
  // a que el servidor mande la pantalla; al llegar, manda la ruta de verdad.
  const [tapped, setTapped] = useState<string | null>(null);
  useEffect(() => setTapped(null), [pathname]);
  return (
    <nav
      aria-label="Navegación principal"
      className="mobile-tabbar flex shrink-0 items-stretch border-t bg-surface px-1 pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {items.map((item) => {
        const active =
          !moreOpen &&
          (tapped
            ? tapped === item.href
            : [item.href, ...(item.alsoActive ?? [])].some((r) => pathWithin(r, pathname)));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => {
              setTapped(item.href);
              onNavigate?.();
            }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11.5px]",
              active ? "font-semibold text-foreground" : "font-medium text-text-2"
            )}
          >
            <TabIcon active={active} badge={item.badge && unread > 0 ? count(unread) : null} label={item.badge ? `${unread} sin leer` : undefined}>
              <Icon className="h-[22px] w-[22px]" strokeWidth={1.7} />
            </TabIcon>
            {SHORT[item.key] ?? item.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        aria-label="Más"
        aria-expanded={moreOpen}
        data-testid="mobile-more-tab"
        className={cn(
          "flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11.5px]",
          moreOpen ? "font-semibold text-foreground" : "font-medium text-text-2"
        )}
      >
        <TabIcon active={moreOpen} dot={teamUnread > 0}>
          <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={1.7} />
        </TabIcon>
        Más
      </button>
    </nav>
  );
}

function TabIcon({
  active,
  badge,
  dot,
  label,
  children,
}: {
  active: boolean;
  badge?: string | null;
  dot?: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "relative flex h-[30px] w-[58px] items-center justify-center rounded-full transition-colors duration-150",
        active ? "bg-brand-tint text-brand-text" : "text-text-2"
      )}
    >
      {children}
      {badge && (
        <span
          aria-label={label}
          className="absolute -top-1 right-1.5 min-w-[18px] rounded-full bg-brand px-1 text-center text-[10px] font-semibold leading-[17px] text-brand-fg tabular-nums"
        >
          {badge}
        </span>
      )}
      {dot && <span className="absolute right-3 top-0.5 h-2 w-2 rounded-full bg-brand" aria-hidden />}
    </span>
  );
}
