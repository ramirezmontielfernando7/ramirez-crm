"use client";

import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, m } from "framer-motion";
import { Bell, MessageCircle, Settings, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItemClass } from "@/components/app-nav";
import { SPRING } from "@/components/motion";
import { markAllRead, markRead, useNotifications, type NotifItem } from "./notification-store";

function ago(at: number): string {
  const min = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

/**
 * Renglón «Avisos» del menú, con el globo rojo de los sin leer, y su panel:
 * lo que pasó en vivo (mensajes de clientes y chats que la IA pasó a una
 * persona). Solo llegan avisos de los chats que le tocan a quien mira: el
 * servidor ya filtra los eventos por visibilidad.
 */
export const AvisosMenu = memo(function AvisosMenu() {
  const { items, unread } = useNotifications();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (card.current?.contains(t) || button.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ left: r.right + 10, bottom: Math.max(12, window.innerHeight - r.bottom - 8) });
    setOpen((v) => !v);
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        title="Avisos"
        aria-label={unread > 0 ? `Avisos, ${unread} nuevos` : "Avisos"}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="nav-avisos"
        className={cn(navItemClass(open), "relative w-full text-left")}
      >
        <Bell className={cn("h-[17px] w-[17px] shrink-0", open ? "text-brand" : "text-text-3")} strokeWidth={1.8} />
        <span className="flex-1 whitespace-nowrap group-data-[mini]/nav:hidden">Avisos</span>
        {unread > 0 && (
          <span
            data-testid="avisos-badge"
            className="min-w-[18px] rounded-full bg-danger px-1.5 text-center text-[10.5px] font-semibold leading-[18px] text-white group-data-[mini]/nav:absolute group-data-[mini]/nav:right-1 group-data-[mini]/nav:top-0.5 group-data-[mini]/nav:min-w-[14px] group-data-[mini]/nav:px-1 group-data-[mini]/nav:text-[9px] group-data-[mini]/nav:leading-[14px]"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <m.div
                ref={card}
                role="dialog"
                aria-label="Avisos"
                initial={{ opacity: 0, scale: 0.97, x: -4 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
                transition={SPRING}
                style={{ left: pos.left, bottom: pos.bottom, transformOrigin: "bottom left" }}
                className="fixed z-50 flex max-h-[min(480px,calc(100vh-24px))] w-[340px] flex-col overflow-hidden rounded-md border bg-popover text-foreground shadow-pop"
              >
                <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
                  <span className="text-[14px] font-semibold">Avisos</span>
                  {unread > 0 && (
                    <span className="rounded-full bg-danger-tint px-2 py-0.5 text-[11px] font-semibold text-danger-text">
                      {unread} {unread === 1 ? "nuevo" : "nuevos"}
                    </span>
                  )}
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={markAllRead}
                    disabled={unread === 0}
                    className="text-[12px] font-semibold text-brand-ink hover:underline disabled:text-text-3 disabled:no-underline"
                  >
                    Marcar todo como leído
                  </button>
                  <Link
                    href="/settings/personalization/notificaciones"
                    onClick={() => setOpen(false)}
                    aria-label="Ajustes de avisos"
                    title="Ajustes de avisos"
                    className="rounded p-1 text-text-3 hover:bg-secondary hover:text-foreground"
                  >
                    <Settings className="h-4 w-4" strokeWidth={1.7} />
                  </Link>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {items.length === 0 ? (
                    <p className="px-4 py-8 text-center text-[13px] text-text-3">
                      Sin avisos por ahora. Aquí verás los mensajes nuevos y los chats que la IA te pase.
                    </p>
                  ) : (
                    <ul>
                      {items.map((i) => (
                        <AvisoRow key={i.id} item={i} onGo={() => { markRead(i.id); setOpen(false); }} />
                      ))}
                    </ul>
                  )}
                </div>
                <p className="border-t px-3.5 py-2 text-[11.5px] text-text-3">Solo ves avisos de los chats que te tocan.</p>
              </m.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
});

function AvisoRow({ item, onGo }: { item: NotifItem; onGo: () => void }) {
  const Icon = item.kind === "handoff" ? UserRound : MessageCircle;
  return (
    <li>
      <Link
        href={item.href}
        onClick={onGo}
        className={cn("flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-accent", !item.read && "bg-brand-soft/40")}
      >
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            item.kind === "handoff" ? "bg-warning-tint text-warning-text" : "bg-brand-soft text-brand-text"
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{item.title}</span>
          <span className="line-clamp-2 text-[12px] text-text-2">{item.detail}</span>
          <span className="block text-[11px] text-text-3">{ago(item.at)}</span>
        </span>
        {!item.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Sin leer" />}
      </Link>
    </li>
  );
}
