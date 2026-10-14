"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Inbox, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useViewer } from "@/components/viewer-context";
import { useTeamUnread } from "@/components/team-chat/unread-store";
import { FloatingMenu, type MenuAnchor } from "./floating-menu";
import { useInboxUnread } from "./unread-store";

/**
 * 039 — El título de la columna de la Bandeja y del Chat de equipo. Con el
 * módulo `team_chat` encendido es un selector («Bandeja ▾» / «Chat de equipo
 * ▾») que cambia entre las dos (son rutas: /inbox y /chat), con el conteo de
 * no leídos de cada una y un punto junto al título cuando hay actividad en la
 * OTRA. Sin el módulo, el título de siempre, sin flecha ni menú.
 *
 * No agrega ninguna barra: vive en el encabezado compacto de la lista, así la
 * Bandeja conserva sus columnas a altura completa.
 */
export type InboxMode = "inbox" | "chat";

const MODES: readonly { mode: InboxMode; href: string; title: string; label: string; hint: string; icon: typeof Inbox }[] = [
  { mode: "inbox", href: "/inbox", title: "Bandeja", label: "Bandeja de clientes", hint: "Conversaciones con tus clientes", icon: Inbox },
  { mode: "chat", href: "/chat", title: "Chat de equipo", label: "Chat de equipo", hint: "Interno: nada sale a los clientes", icon: MessagesSquare },
];

const count = (n: number) => (n > 99 ? "99+" : String(n));

export function InboxModeSwitch({ current, className }: { current: InboxMode; className?: string }) {
  const viewer = useViewer();
  const teamChat = viewer.hasModule("team_chat");
  const here = MODES.find((m) => m.mode === current)!;
  const heading = cn("text-[17px] font-bold tracking-tight", className);

  if (!teamChat) return <h2 className={heading}>{here.title}</h2>;
  return <ModeMenu current={current} heading={heading} />;
}

function ModeMenu({ current, heading }: { current: InboxMode; heading: string }) {
  const viewer = useViewer();
  const inboxUnread = useInboxUnread();
  const teamUnread = useTeamUnread(viewer.userId);
  const trigger = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  const here = MODES.find((m) => m.mode === current)!;
  const unreadOf = (m: InboxMode) => (m === "inbox" ? inboxUnread : teamUnread);
  const other: InboxMode = current === "inbox" ? "chat" : "inbox";
  const otherUnread = unreadOf(other);

  return (
    <h2 className={heading}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        title="Cambiar entre la Bandeja de clientes y el Chat de equipo"
        data-testid="inbox-mode-switch"
        onClick={() => {
          const rect = trigger.current?.getBoundingClientRect();
          setAnchor((a) => (a || !rect ? null : { kind: "rect", rect }));
        }}
        className={cn(
          "-mx-1 flex items-center gap-0.5 whitespace-nowrap rounded-md px-1 py-0.5 font-bold transition-colors hover:bg-accent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          anchor && "bg-accent"
        )}
      >
        {here.title}
        <ChevronDown
          aria-hidden
          className={cn("h-3.5 w-3.5 shrink-0 text-text-3 transition-transform duration-150", anchor && "rotate-180")}
          strokeWidth={2}
        />
        {otherUnread > 0 && (
          <span
            data-testid="inbox-mode-dot"
            aria-label={`Sin leer en ${MODES.find((m) => m.mode === other)!.label}`}
            className="ml-0.5 h-2 w-2 shrink-0 rounded-full bg-brand"
          />
        )}
      </button>
      {anchor && (
        <FloatingMenu anchor={anchor} onClose={close} label="Cambiar de bandeja" triggerRef={trigger} className="w-72 p-1.5">
          {MODES.map((m) => {
            const active = m.mode === current;
            const n = unreadOf(m.mode);
            return (
              <Link
                key={m.mode}
                href={m.href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                onClick={close}
                className={cn(
                  "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-brand-tint text-brand-text" : "hover:bg-accent"
                )}
              >
                <m.icon aria-hidden className={cn("h-4 w-4 shrink-0", active ? "text-brand" : "text-text-3")} strokeWidth={1.8} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold leading-tight">{m.label}</span>
                  <span className="block truncate text-[11.5px] font-normal text-text-3">{m.hint}</span>
                </span>
                {n > 0 && (
                  <span
                    aria-label={`${n} sin leer`}
                    className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-bold text-brand-fg"
                  >
                    {count(n)}
                  </span>
                )}
                {active && n === 0 && <Check aria-hidden className="h-4 w-4 shrink-0 text-brand" strokeWidth={2} />}
              </Link>
            );
          })}
        </FloatingMenu>
      )}
    </h2>
  );
}
