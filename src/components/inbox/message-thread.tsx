"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Ellipsis, Reply, SmilePlus } from "lucide-react";
import type { MessageDto } from "@/lib/types";
import { validCustomerReaction } from "@/lib/customer-message-annotations";
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
type MessageActions = {
  onReply?: (message: MessageDto) => void;
  onReact?: (message: MessageDto, emoji: string) => Promise<void>;
};

export const MessageThread = memo(function MessageThread({
  messages, incomingName, onReply, onReact,
}: MessageActions & { messages: MessageDto[]; incomingName?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const loaded = new Set(messages.map((message) => message.id));

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
      data-message-thread
      className="thread-bg flex flex-1 flex-col overflow-y-auto px-3 py-5 sm:px-8"
    >
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay =
          !prev ||
          new Date(prev.createdAt).toDateString() !==
            new Date(m.createdAt).toDateString();
        const grouped =
          !newDay && prev !== undefined && prev.direction === m.direction && prev.groupSenderId === m.groupSenderId;
        const out = m.direction === "out";

        return (
          <div key={m.id} data-message-id={m.id}>
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
              {out && <MessageMenu message={m} onReply={onReply} onReact={onReact} />}
              <MessageBubble m={m} grouped={grouped} incomingName={incomingName}
                onJumpQuote={m.replyTo && loaded.has(m.replyTo.id) ? () => {
                  const target = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(m.replyTo!.id)}"]`);
                  target?.scrollIntoView({ block: "center" });
                  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
                    target?.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 300 });
                } : undefined} />
              {!out && <MessageMenu message={m} onReply={onReply} onReact={onReact} />}
            </div>
            {!!m.reactions?.length && (
              <div className={cn("mt-1 flex flex-wrap gap-1", out ? "justify-end" : "justify-start")} aria-label="Reacciones del mensaje">
                {m.reactions.map((reaction) => (
                  <span key={reaction.direction} aria-label={`${reaction.emoji} ${reaction.direction === "out" ? "del equipo" : "del cliente"}`}
                    className={cn("flex h-6 items-center rounded-full border px-2 text-[12px]",
                      reaction.direction === "out" ? "border-brand bg-brand-tint text-brand-text" : "border-border-strong bg-background text-text-2")}>{reaction.emoji}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

const quickReactions = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function MessageMenu({ message, onReply, onReact }: MessageActions & { message: MessageDto }) {
  const [choices, setChoices] = useState(false);
  const [above, setAbove] = useState(false);
  const [emoji, setEmoji] = useState("");
  const [busy, setBusy] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  if ((!onReply && !onReact) || message.id.startsWith("tmp_")) return null;

  const own = message.reactions?.find((reaction) => reaction.direction === "out")?.emoji;
  async function react(value: string) {
    if (!onReact || busy) return;
    setBusy(true);
    try {
      await onReact(message, value === own ? "" : value);
      if (menu.current) menu.current.open = false;
      setEmoji("");
      setChoices(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details ref={menu} name="customer-message-actions" className="relative mx-0.5 self-start"
      onToggle={(event) => {
        const item = event.currentTarget;
        const thread = item.closest("[data-message-thread]");
        if (item.open && thread) {
          const box = item.getBoundingClientRect(), viewport = thread.getBoundingClientRect();
          setAbove(viewport.bottom - box.bottom < 210 && box.top - viewport.top > 210);
        }
      }}>
      <summary aria-label="Acciones del mensaje" className="list-none cursor-pointer rounded-md p-1.5 text-text-3 hover:bg-surface-2 focus-visible:outline focus-visible:outline-brand">
        <Ellipsis className="h-4 w-4" aria-hidden />
      </summary>
      <div className={cn("absolute z-30 min-w-36 rounded-md border bg-popover p-1 text-xs shadow-pop", above ? "bottom-full" : "top-full", message.direction === "out" ? "right-0" : "left-0")}>
        {onReply && <button type="button" className="flex w-full items-center gap-1.5 rounded p-2 text-left hover:bg-surface-2"
          onClick={() => { onReply(message); if (menu.current) menu.current.open = false; }}>
          <Reply className="h-4 w-4" aria-hidden /> Responder
        </button>}
        {onReact && <>
          <button type="button" aria-expanded={choices} className="flex w-full items-center gap-1.5 rounded p-2 text-left hover:bg-surface-2"
            onClick={() => setChoices(!choices)}><SmilePlus className="h-4 w-4" aria-hidden /> Reaccionar</button>
          {choices && <div className="w-44 p-1">
            <div className="flex flex-wrap gap-1">
              {quickReactions.map((value) => <button key={value} type="button" disabled={busy} aria-label={`Reaccionar con ${value}`} aria-pressed={own === value}
                className="rounded border px-1.5 py-1 hover:bg-surface-2" onClick={() => void react(value)}>{value}</button>)}
            </div>
            <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (emoji && validCustomerReaction(emoji)) void react(emoji); }}>
              <input aria-label="Otra reacción" maxLength={48} value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-20 rounded border bg-background px-1" />
              <button type="submit" disabled={busy || !emoji || !validCustomerReaction(emoji)} className="rounded border px-1 py-0.5 disabled:opacity-50">Aplicar</button>
            </form>
            {own && <button type="button" disabled={busy} onClick={() => void react("")} className="mt-1 rounded p-1 hover:bg-surface-2">Quitar reacción</button>}
          </div>}
        </>}
      </div>
    </details>
  );
}
