"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { useViewer } from "@/components/viewer-context";
import { useTeamUnread } from "@/components/team-chat/unread-store";
import { useInboxUnread } from "./unread-store";
import { useNumberUnread } from "./number-unread-store";
import { NavRevealButton } from "@/components/nav-mode";

/**
 * 039 — Las pestañas de la Bandeja: «Empresa» (los clientes) y «Equipo» (el
 * chat interno). Siempre a la vista, cada una con su conteo de no leídos; son
 * rutas (/inbox y /chat). Sin el módulo `team_chat` solo queda «Empresa», y
 * con una sola pestaña no se dibuja ninguna barra. «Mi número» (046) sale
 * a quien tiene su propio número y (PR 7) a quien supervisa los números del
 * equipo; sin número propio se llama «Números».
 */
export type InboxMode = "inbox" | "number" | "chat";

const TABS: readonly {
  mode: InboxMode;
  href: string;
  label: string;
  aria: string;
  needs?: "team_chat" | "my_number";
}[] = [
  {
    mode: "inbox",
    href: "/inbox",
    label: "Clientes",
    aria: "Bandeja de clientes",
  },
  {
    mode: "number",
    href: "/inbox/mi-numero",
    label: "Mi número",
    aria: "Los chats de tu número",
    needs: "my_number",
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

type Viewer = ReturnType<typeof useViewer>;

const shows = (viewer: Viewer) => (t: (typeof TABS)[number]) =>
  !t.needs || (t.needs === "my_number" ? viewer.hasMyNumber || viewer.seesTeamNumbers : viewer.hasModule(t.needs));

const labelOf = (viewer: Viewer, t: (typeof TABS)[number]) =>
  t.mode === "number" && !viewer.hasMyNumber ? "Números" : t.label;

/** ¿Hay pestañas que mostrar? Con una sola no se dibuja ninguna. */
export function useHasInboxTabs() {
  const viewer = useViewer();
  return TABS.filter(shows(viewer)).length > 1;
}

/**
 * Ronda 3 — El encabezado de 56 px de la columna de chats, igual en Clientes,
 * Mi número y Equipo: a la izquierda el selector segmentado (Clientes · Mi
 * número · Equipo, cada uno con su globo de no leídos) y a la derecha las
 * acciones de esa bandeja. Con una sola bandeja, en lugar del selector va su
 * nombre. Son rutas (/inbox, /inbox/mi-numero, /chat).
 */
export function InboxListHeader({
  current,
  actions,
  rowRef,
  flush,
}: {
  /** Sin línea inferior: debajo van los chips de filtro y se ve más limpio. */
  flush?: boolean;
  current: InboxMode;
  actions?: React.ReactNode;
  rowRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const viewer = useViewer();
  const inboxUnread = useInboxUnread();
  const teamUnread = useTeamUnread(viewer.userId);
  const numberUnread = useNumberUnread(viewer.hasMyNumber);
  const tabs = TABS.filter(shows(viewer));

  return (
    <header className={cn("relative flex h-14 shrink-0 items-center gap-2 px-4", !flush && "border-b")} ref={rowRef}>
      <NavRevealButton />
      {tabs.length < 2 ? (
        <h2 className="text-[16px] font-semibold">{labelOf(viewer, tabs[0] ?? TABS[0]!)}</h2>
      ) : (
        <nav aria-label="Cambiar de bandeja" data-testid="inbox-tabs" className="seg min-w-0 overflow-x-auto [scrollbar-width:none]">
          {tabs.map((t) => {
            const active = t.mode === current;
            const n = t.mode === "inbox" ? inboxUnread : t.mode === "number" ? numberUnread : teamUnread;
            return (
              <Link
                key={t.mode}
                href={t.href}
                aria-current={active ? "page" : undefined}
                data-testid={`inbox-tab-${t.mode}`}
                title={t.aria}
                className="seg-item"
              >
                {labelOf(viewer, t)}
                {n > 0 && (
                  <span aria-label={`${n} sin leer`} className="seg-count">
                    {count(n)}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
    </header>
  );
}
