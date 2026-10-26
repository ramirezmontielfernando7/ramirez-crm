"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useViewer } from "@/components/viewer-context";
import { useTeamUnread } from "@/components/team-chat/unread-store";
import { useInboxUnread } from "./unread-store";

/**
 * 039 — Las pestañas de la Bandeja: «Empresa» (los clientes) y «Equipo» (el
 * chat interno). Siempre a la vista, cada una con su conteo de no leídos; son
 * rutas (/inbox y /chat). Sin el módulo `team_chat` solo queda «Empresa», y
 * con una sola pestaña no se dibuja ninguna barra. El hueco para «Mi número»
 * es agregar una entrada más a TABS.
 */
export type InboxMode = "inbox" | "chat";

const TABS: readonly {
  mode: InboxMode;
  href: string;
  label: string;
  aria: string;
  needs?: "team_chat";
}[] = [
  {
    mode: "inbox",
    href: "/inbox",
    label: "Empresa",
    aria: "Bandeja de clientes",
  },
  {
    mode: "chat",
    href: "/chat",
    label: "Equipo",
    aria: "Chat de equipo",
    needs: "team_chat",
  },
];

const count = (n: number) => (n > 99 ? "99+" : String(n));

/** El título de la columna: fijo, sin menú. */
export function InboxModeSwitch({
  className,
}: {
  current?: InboxMode;
  className?: string;
}) {
  return (
    <h2 className={cn("text-[17px] font-bold tracking-tight", className)}>
      Chats
    </h2>
  );
}

/** ¿Hay pestañas que mostrar? Con una sola no se dibuja ninguna. */
export function useHasInboxTabs() {
  const viewer = useViewer();
  return TABS.filter((t) => !t.needs || viewer.hasModule(t.needs)).length > 1;
}

/**
 * La tira de pestañas bajo el título; `children` va a la derecha de la misma
 * fila (los botones de seleccionar y buscar). No dibuja nada si solo hay una.
 */
export function InboxTabs({
  current,
  children,
  rowRef,
  className,
}: {
  current: InboxMode;
  children?: React.ReactNode;
  rowRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  const viewer = useViewer();
  const inboxUnread = useInboxUnread();
  const teamUnread = useTeamUnread(viewer.userId);
  const tabs = TABS.filter((t) => !t.needs || viewer.hasModule(t.needs));
  if (tabs.length < 2) return null;

  return (
    <div
      ref={rowRef}
      className="relative flex shrink-0 items-center gap-2 px-4 pb-2.5 pt-0.5"
    >
      <nav
        aria-label="Cambiar de bandeja"
        data-testid="inbox-tabs"
        className={cn(
          "flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]",
          className,
        )}
      >
        {tabs.map((t) => {
          const active = t.mode === current;
          const n = t.mode === "inbox" ? inboxUnread : teamUnread;
          return (
            <Link
              key={t.mode}
              href={t.href}
              aria-current={active ? "page" : undefined}
              data-testid={`inbox-tab-${t.mode}`}
              title={t.aria}
              className={cn(
                "flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] border px-2 text-[11px] font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-brand/30 bg-brand-tint text-brand-text"
                  : "border-transparent bg-secondary text-text-2 hover:bg-accent hover:text-foreground",
              )}
            >
              {t.label}
              {n > 0 && (
                <span
                  aria-label={`${n} sin leer`}
                  className="text-[11px] font-bold tabular-nums text-brand"
                >
                  {count(n)}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
