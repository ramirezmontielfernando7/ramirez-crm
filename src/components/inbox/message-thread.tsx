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

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div
      ref={scrollRef}
      className="thread-bg flex flex-1 flex-col gap-[3px] overflow-y-auto px-3 py-5 sm:px-[6%]"
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
              <div className="my-3 flex justify-center">
                <span className="kicker rounded-full border border-border-strong bg-background px-3 py-1 text-text-2 shadow-sm">
                  {dayLabel(m.createdAt)}
                </span>
              </div>
            )}
            <div
              className={cn(
                "flex",
                out ? "justify-end" : "justify-start",
                grouped ? "mt-[3px]" : "mt-2.5"
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
