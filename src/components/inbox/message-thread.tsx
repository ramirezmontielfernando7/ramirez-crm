"use client";

import { memo, useEffect, useRef } from "react";
import type { MessageDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MessageBubble } from "./message-bubble";

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}


/**
 * Memoizado: abrir o cerrar Detalles (u otro estado de la Bandeja que no
 * toca los mensajes) no vuelve a pintar cientos de burbujas; así la
 * animación del panel arranca en el siguiente cuadro.
 */
export const MessageThread = memo(function MessageThread({ messages }: { messages: MessageDto[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // D2 — Solo se animan los mensajes que llegan o se envían EN VIVO: los
  // mismos de antes más unos pocos nuevos. Abrir o cambiar de chat (otro
  // primer mensaje, o la lista que pasa de vacía a llena) no anima nada, así
  // un historial de cientos de mensajes se pinta de golpe.
  const seen = useRef<{ first: string | null; ids: Set<string> }>({
    first: null,
    ids: new Set(),
  });
  const first = messages[0]?.id ?? null;
  const fresh = new Set<string>();
  if (seen.current.first === first && seen.current.ids.size > 0) {
    for (const m of messages) if (!seen.current.ids.has(m.id)) fresh.add(m.id);
    if (fresh.size > 5) fresh.clear();
  }
  useEffect(() => {
    seen.current = { first, ids: new Set(messages.map((m) => m.id)) };
  }, [messages, first]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div
      ref={scrollRef}
      className="thread-bg flex flex-1 flex-col overflow-y-auto px-3 py-5 sm:px-8"
    >
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay =
          !prev ||
          new Date(prev.createdAt).toDateString() !==
            new Date(m.createdAt).toDateString();
        const grouped =
          !newDay && prev !== undefined && prev.direction === m.direction;
        const out = m.direction === "out";

        return (
          <div key={m.id}>
            {newDay && (
              <div className="my-1 flex justify-center">
                <span className="day-pill rounded-full border bg-surface px-2.5 text-[11px] font-semibold leading-5 text-text-3">
                  {dayLabel(m.createdAt)}
                </span>
              </div>
            )}
            <div
              className={cn(
                "flex",
                out ? "justify-end" : "justify-start",
                grouped ? "msg-grouped mt-1.5" : "msg-first mt-1.5",
                fresh.has(m.id) && "bubble-enter"
              )}
            >
              <MessageBubble m={m} grouped={grouped} />
            </div>
          </div>
        );
      })}
    </div>
  );
});
