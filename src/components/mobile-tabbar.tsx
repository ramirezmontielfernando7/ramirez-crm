"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItemOf } from "@/components/app-nav";
import { useInboxUnread } from "@/components/inbox/unread-store";
import { pathWithin, type NavEntries } from "@/lib/modules/nav-layout";

/**
 * Barra de pestañas del teléfono (maqueta móvil): los primeros pilares del
 * menú y «Más», que abre el cajón con el resto. Solo bajo `lg`. Se esconde
 * con un chat abierto (`html[data-chat-open]`) para dejar el compositor libre.
 */
export function MobileTabBar({ nav, onMore }: { nav?: NavEntries; onMore: () => void }) {
  const pathname = usePathname();
  const unread = useInboxUnread();
  const keys = (nav?.keys ?? ["inbox", "pipeline"]).slice(0, 4);
  const items = keys.map((k) => navItemOf(k, nav?.hrefs?.[k]));
  return (
    <nav
      aria-label="Navegación principal"
      className="mobile-tabbar flex shrink-0 items-stretch border-t bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {items.map((item) => {
        const active = [item.href, ...(item.alsoActive ?? [])].some((r) => pathWithin(r, pathname));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
              active ? "text-brand-text" : "text-text-3"
            )}
          >
            <span className="relative">
              <Icon className="h-5 w-5" strokeWidth={1.6} />
              {item.badge && unread > 0 && (
                <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-brand" aria-label={`${unread} sin leer`} />
              )}
            </span>
            {item.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        aria-label="Abrir el menú"
        className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-text-3"
      >
        <MoreHorizontal className="h-5 w-5" strokeWidth={1.6} />
        Más
      </button>
    </nav>
  );
}
