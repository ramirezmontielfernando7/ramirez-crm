"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, m } from "motion/react";
import { FileText, Pencil, SmilePlus, Trash2 } from "lucide-react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import {
  isMine,
  reactedByMe,
  TEAM_MESSAGE_MAX,
  type TeamMessageDto,
  type TeamThreadKind,
} from "@/lib/team-chat";
import { cn } from "@/lib/utils";
import { SPRING } from "@/components/motion";
import { formatBytes } from "@/components/inbox/helpers";

const EmojiPickerPanel = dynamic(() => import("@/components/inbox/emoji-picker"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[340px] w-[304px] items-center justify-center text-xs text-text-3">
      Cargando emojis…
    </div>
  ),
});

/** Reacciones a un toque (el resto, en el selector). */
const QUICK = ["👍", "❤️", "😂", "🎉", "👀"];

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}

function bubbleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * 025 — El hilo del chat de equipo: burbujas (las propias a la derecha),
 * reacciones, editar y borrar lo propio, y "ver anteriores" arriba. Cada
 * acción fallida se explica bajo su mensaje.
 */
export function TeamThread({
  kind,
  userId,
  messages,
  hasMore,
  loadingOlder,
  canReact,
  onLoadOlder,
  onChanged,
}: {
  kind: TeamThreadKind;
  userId: string;
  messages: TeamMessageDto[];
  hasMore: boolean;
  loadingOlder: boolean;
  canReact: boolean;
  onLoadOlder: () => void;
  onChanged: (message: TeamMessageDto) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastId = messages[messages.length - 1]?.id;
  const firstId = messages[0]?.id;
  const prevFirst = useRef<string | undefined>(undefined);
  const prevHeight = useRef(0);

  // Mensaje nuevo al final: baja solo si ya estaba abajo (no le quita a nadie
  // lo que estaba leyendo). Página vieja arriba: conserva la posición.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevFirst.current && firstId !== prevFirst.current && prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirst.current = firstId;
    prevHeight.current = el.scrollHeight;
  }, [lastId, firstId, messages.length]);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        prevHeight.current = el.scrollHeight;
      }}
      className="thread-bg flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto px-3 py-5 sm:px-[6%]"
    >
      {hasMore && (
        <div className="mb-2 flex justify-center">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            className="rounded-full border border-border-strong bg-background px-3 py-1 text-[12px] font-medium text-text-2 shadow-sm transition-colors hover:text-foreground disabled:opacity-60"
          >
            {loadingOlder ? "Cargando…" : "Ver mensajes anteriores"}
          </button>
        </div>
      )}
      {messages.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
          <p className="font-serif text-[20px] italic text-text-2">Todavía no hay mensajes</p>
          <p className="kicker">Escribe el primero</p>
        </div>
      )}
      {messages.map((msg, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(msg.createdAt).toDateString();
        const grouped = !newDay && prev?.author?.id === msg.author?.id && !prev?.deleted;
        return (
          <div key={msg.id}>
            {newDay && (
              <div className="my-3 flex justify-center">
                <span className="kicker rounded-full border border-border-strong bg-background px-3 py-1 text-text-2 shadow-sm">
                  {dayLabel(msg.createdAt)}
                </span>
              </div>
            )}
            <Bubble
              message={msg}
              mine={isMine(msg, userId)}
              userId={userId}
              grouped={grouped}
              showAuthor={kind !== "direct" && !grouped}
              canReact={canReact}
              onChanged={onChanged}
            />
          </div>
        );
      })}
    </div>
  );
}

function Bubble({
  message,
  mine,
  userId,
  grouped,
  showAuthor,
  canReact,
  onChanged,
}: {
  message: TeamMessageDto;
  mine: boolean;
  userId: string;
  grouped: boolean;
  showAuthor: boolean;
  canReact: boolean;
  onChanged: (message: TeamMessageDto) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  async function call(url: string, init: RequestInit, what: string) {
    setBusy(true);
    setError(null);
    const res = await fetchJson<{ message: TeamMessageDto }>(url, init);
    setBusy(false);
    if (!res.ok) {
      setError(`No se pudo ${what}: ${res.error}`);
      return false;
    }
    onChanged(res.data.message);
    return true;
  }

  async function toggleReaction(emoji: string) {
    setPickerOpen(false);
    const had = message.reactions.some((r) => r.emoji === emoji && reactedByMe(r, userId));
    await call(
      `/api/team-chat/messages/${message.id}/reactions`,
      jsonInit(had ? "DELETE" : "PUT", { emoji }),
      had ? "quitar la reacción" : "reaccionar"
    );
  }

  async function saveEdit() {
    const body = draft.trim();
    if (body.length > TEAM_MESSAGE_MAX) {
      setError(`El mensaje pasa de ${TEAM_MESSAGE_MAX} caracteres`);
      return;
    }
    if (await call(`/api/team-chat/messages/${message.id}`, jsonInit("PATCH", { body }), "editar")) {
      setEditing(false);
    }
  }

  async function remove() {
    if (await call(`/api/team-chat/messages/${message.id}`, { method: "DELETE" }, "borrar")) {
      setConfirmDelete(false);
    }
  }

  const actions = !message.deleted && !editing && (canReact || mine);

  return (
    <div className={cn("group/msg flex flex-col", mine ? "items-end" : "items-start", grouped ? "mt-[3px]" : "mt-2.5")}>
      {showAuthor && !mine && message.author && (
        <span className="mb-0.5 px-1 text-[11.5px] font-semibold text-text-2">{message.author.name}</span>
      )}
      <div className={cn("relative flex max-w-[85%] items-center gap-1 sm:max-w-[64%]", mine && "flex-row-reverse")}>
        <div
          className={cn(
            "min-w-0 rounded-[14px] border px-3 pb-1.5 pt-2 text-[13.5px] leading-[1.45] shadow-sm",
            mine
              ? "border-bubble-out-border bg-bubble-out text-bubble-out-text"
              : "border-bubble-in-border bg-bubble-in",
            !grouped && (mine ? "rounded-tr-[5px]" : "rounded-tl-[5px]"),
            message.deleted && "italic text-text-3"
          )}
        >
          {message.deleted ? (
            <span>Mensaje eliminado</span>
          ) : editing ? (
            <span className="flex flex-col gap-1.5">
              <textarea
                value={draft}
                autoFocus
                rows={Math.min(6, Math.max(2, draft.split("\n").length))}
                aria-label="Editar mensaje"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void saveEdit();
                  }
                  if (e.key === "Escape") setEditing(false);
                }}
                className="w-[min(60vw,420px)] resize-none rounded-md border border-border-strong bg-background px-2 py-1.5 text-[13.5px] text-foreground outline-none focus:border-brand"
              />
              <span className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(message.body);
                  }}
                  className="rounded px-2 py-1 text-[12px] font-medium text-text-2 hover:bg-secondary"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveEdit()}
                  className="rounded bg-brand px-2 py-1 text-[12px] font-semibold text-brand-fg disabled:opacity-50"
                >
                  Guardar
                </button>
              </span>
            </span>
          ) : (
            <>
              {message.attachment && <Attachment attachment={message.attachment} />}
              {message.body && (
                <span className={cn("block whitespace-pre-wrap break-words", message.attachment && "mt-1")}>
                  {message.body}
                </span>
              )}
            </>
          )}
          {!editing && (
            <span className="float-right ml-2 mt-1 flex items-center gap-1">
              {message.editedAt && !message.deleted && (
                <span className="text-[10px] font-medium text-text-3">editado</span>
              )}
              <span className="font-mono text-[10px] tracking-[0.04em] text-text-3">{bubbleTime(message.createdAt)}</span>
            </span>
          )}
        </div>

        {actions && (
          // Aparecen con hover o foco (teclado); en pantallas táctiles, siempre.
          <div
            className={cn(
              "flex shrink-0 items-center gap-0.5 transition-opacity duration-150",
              "opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 [@media(hover:none)]:opacity-100",
              pickerOpen && "opacity-100"
            )}
          >
            {canReact && (
              <div ref={pickerRef} className="relative">
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-label="Reaccionar"
                  title="Reaccionar"
                  className="rounded p-1 text-text-3 hover:bg-secondary hover:text-foreground"
                >
                  <SmilePlus className="h-4 w-4" strokeWidth={1.7} />
                </button>
                <AnimatePresence>
                  {pickerOpen && (
                    <m.div
                      role="dialog"
                      aria-label="Elegir reacción"
                      initial={{ opacity: 0, y: 6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.1 } }}
                      transition={SPRING}
                      style={{ transformOrigin: mine ? "bottom right" : "bottom left" }}
                      className={cn(
                        "absolute bottom-full z-30 mb-2 overflow-hidden rounded-md border bg-popover text-foreground shadow-pop",
                        mine ? "right-0" : "left-0"
                      )}
                    >
                      <div className="flex gap-0.5 border-b p-1.5">
                        {QUICK.map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => void toggleReaction(e)}
                            aria-label={`Reaccionar con ${e}`}
                            className="rounded-md px-1.5 py-1 text-lg transition-transform hover:bg-secondary active:scale-90"
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                      <EmojiPickerPanel onPick={(e) => void toggleReaction(e)} />
                    </m.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            {mine && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(message.body);
                    setEditing(true);
                  }}
                  aria-label="Editar mensaje"
                  title="Editar"
                  className="rounded p-1 text-text-3 hover:bg-secondary hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.7} />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Borrar mensaje"
                  title="Borrar"
                  className="rounded p-1 text-text-3 hover:bg-danger-tint hover:text-danger-text"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {message.reactions.length > 0 && (
        <div className={cn("mt-1 flex flex-wrap gap-1", mine ? "justify-end" : "justify-start")}>
          {message.reactions.map((r) => {
            const me = reactedByMe(r, userId);
            return (
              <button
                key={r.emoji}
                type="button"
                disabled={!canReact || busy}
                onClick={() => void toggleReaction(r.emoji)}
                aria-pressed={me}
                aria-label={`${r.emoji} ${r.userIds.length}${me ? " (tuya)" : ""}`}
                className={cn(
                  "flex h-6 items-center gap-1 rounded-full border px-2 text-[12px] tabular-nums transition-colors disabled:cursor-default",
                  me ? "border-brand bg-brand-tint text-brand-text" : "border-border-strong bg-background text-text-2 enabled:hover:border-text-3"
                )}
              >
                <span>{r.emoji}</span>
                <span className="font-semibold">{r.userIds.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {confirmDelete && (
        <div className="mt-1 flex items-center gap-2 rounded-md border border-danger-soft bg-danger-tint px-2.5 py-1.5 text-[12px] text-danger-text">
          ¿Borrar este mensaje para todos?
          <button type="button" onClick={() => setConfirmDelete(false)} className="rounded px-1.5 py-0.5 font-medium hover:bg-background">
            No
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="rounded bg-danger px-1.5 py-0.5 font-semibold text-white disabled:opacity-50"
          >
            Sí, borrar
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-[11.5px] text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

function Attachment({ attachment }: { attachment: NonNullable<TeamMessageDto["attachment"]> }) {
  if (attachment.inline) {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer noopener" title="Ver completa">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.url} alt={attachment.name} loading="lazy" className="max-h-72 max-w-full rounded-md object-contain" />
      </a>
    );
  }
  return (
    <a
      href={attachment.url}
      download={attachment.name}
      className="flex items-center gap-2 rounded-md border border-border-strong bg-background px-2.5 py-2 text-foreground hover:bg-subtle"
    >
      <FileText className="h-6 w-6 shrink-0 text-brand" strokeWidth={1.5} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{attachment.name}</span>
        <span className="block text-[12px] text-text-3">{formatBytes(attachment.size)}</span>
      </span>
    </a>
  );
}
