"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, m } from "motion/react";
import { UserRound, X } from "lucide-react";
import { HANDOFF_LABEL } from "@/lib/analytics";
import { useEvents } from "@/components/use-events";
import { playChime } from "@/components/team-chat/unread-store";
import { SPRING } from "@/components/motion";

type Notice = { id: string; contactId: string; contactName: string; reason: string };

/** Cuánto se queda un aviso si nadie lo cierra. */
const NOTICE_MS = 9000;

/**
 * 026 — Aviso de handoff: "este chat necesita a una persona". Solo le llega
 * a quien el servidor se lo manda (`handoff.requested`: el asignado, los
 * Coordinadores y el Propietario; nunca a los participantes). Un toast con
 * sonido y un enlace al chat. Entra y sale solo con `opacity` + `transform`.
 */
export function HandoffNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setNotices((n) => n.filter((x) => x.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);

  useEvents({
    onHandoffRequested: (data) => {
      const id = `${data.conversationId}:${Date.now()}`;
      // Uno por chat: un segundo aviso del mismo chat reemplaza al anterior.
      setNotices((n) => [
        ...n.filter((x) => x.contactId !== data.contactId).slice(-2),
        { id, contactId: data.contactId, contactName: data.contactName, reason: data.reason },
      ]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), NOTICE_MS)
      );
      playChime();
    },
  });

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {notices.map((n) => (
          <m.div
            key={n.id}
            role="status"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
            transition={SPRING}
            className="pointer-events-auto flex items-start gap-2.5 rounded-md border bg-popover p-3 text-foreground shadow-pop"
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warning-tint text-warning-text">
              <UserRound className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">Atención humana: {n.contactName}</span>
              <span className="block text-[12px] text-text-2">{HANDOFF_LABEL[n.reason] ?? "El agente pasó el chat a una persona"}</span>
              <Link
                href={`/inbox?contact=${encodeURIComponent(n.contactId)}`}
                onClick={() => dismiss(n.id)}
                className="mt-1 inline-block text-[12px] font-semibold text-brand-ink hover:underline"
              >
                Ver chat
              </Link>
            </span>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              aria-label="Cerrar aviso"
              className="rounded p-1 text-text-3 hover:bg-secondary hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
