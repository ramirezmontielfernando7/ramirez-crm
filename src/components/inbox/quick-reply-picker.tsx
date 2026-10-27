"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Search, X, Zap } from "lucide-react";
import { filterQuickReplies, type QuickReplyDto } from "@/lib/quick-replies";
import { cn } from "@/lib/utils";

/**
 * Respuestas rápidas en el compositor (Empresa y Mi número). Dos formas de
 * abrirlo:
 * - `/atajo` en el editor: `query` llega de afuera y el teclado (↑ ↓ Enter
 *   Esc) lo maneja el editor con `active`.
 * - El botón del rayo: sin `query`, trae su propio buscador.
 * Tocar una fila la pone en el editor para revisarla; «Enviar» la manda ya.
 */
export function QuickReplyPicker({
  replies,
  query,
  active,
  onActive,
  busy,
  onInsert,
  onSend,
  onClose,
  onKnowledge,
  canManage,
}: {
  replies: readonly QuickReplyDto[];
  /** Lo escrito tras `/` en el editor; undefined = abierto con el botón (buscador propio). */
  query?: string;
  active: number;
  onActive: (i: number) => void;
  busy: boolean;
  onInsert: (reply: QuickReplyDto) => void;
  onSend: (reply: QuickReplyDto) => void;
  onClose: () => void;
  /** Con el módulo Conocimientos: el atajo para buscar ahí (antes era el `/`). */
  onKnowledge?: () => void;
  canManage: boolean;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const own = query === undefined;
  const shown = filterQuickReplies(replies, own ? search : query);

  useEffect(() => {
    if (own) inputRef.current?.focus();
  }, [own]);

  // La fila elegida con el teclado siempre a la vista.
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const btn =
    "rounded-full border border-border-strong bg-background px-2.5 py-1 text-[11.5px] font-semibold text-text-2 transition-colors hover:border-brand hover:bg-brand-tint hover:text-brand-text disabled:opacity-40";

  return (
    <div role="dialog" aria-label="Respuestas rápidas" className="mb-2.5 rounded-md border bg-subtle p-2.5" data-testid="quick-reply-picker">
      <div className="mb-2 flex items-center gap-2">
        <Zap className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.7} />
        {own ? (
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-3" strokeWidth={1.7} />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                onActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  onActive(Math.min(active + 1, shown.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  onActive(Math.max(active - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const r = shown[active];
                  if (r) onInsert(r);
                }
              }}
              placeholder="Buscar respuesta…"
              aria-label="Buscar respuesta rápida"
              className="w-full rounded-md border border-border-strong bg-background py-1.5 pl-7 pr-2.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </div>
        ) : (
          <p className="flex-1 text-[12.5px] font-semibold text-text-2">
            Respuestas rápidas <span className="font-normal text-text-3">· Enter para ponerla</span>
          </p>
        )}
        <button type="button" onClick={onClose} aria-label="Cerrar respuestas rápidas" className="rounded p-1 text-text-3 hover:bg-secondary">
          <X className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>

      {shown.length === 0 && (
        <p className="px-1 py-2 text-xs text-text-3">
          {replies.length === 0 ? "Aún no hay respuestas rápidas." : "Ninguna respuesta coincide."}
          {canManage && (
            <>
              {" "}
              <Link href="/settings/quick-replies" className="font-semibold text-brand-text underline-offset-2 hover:underline">
                Crearlas en Ajustes
              </Link>
            </>
          )}
        </p>
      )}

      <ul ref={listRef} className="max-h-[240px] space-y-1 overflow-y-auto" role="listbox" aria-label="Respuestas rápidas">
        {shown.map((r, i) => (
          <li
            key={r.id}
            role="option"
            aria-selected={i === active}
            data-index={i}
            onMouseEnter={() => onActive(i)}
            className={cn("flex items-start gap-2 rounded-md border bg-background px-2.5 py-2", i === active ? "border-brand" : "border-transparent")}
          >
            <button
              type="button"
              onClick={() => onInsert(r)}
              className="min-w-0 flex-1 text-left"
              title="Ponerla en el editor para revisarla antes de enviar"
            >
              <span className="block font-mono text-[12.5px] font-semibold text-brand-text">/{r.shortcut}</span>
              <span className="line-clamp-2 whitespace-pre-line text-xs text-text-2">{r.body}</span>
            </button>
            <button type="button" className={cn(btn, "shrink-0")} disabled={busy} onClick={() => onSend(r)}>
              Enviar
            </button>
          </li>
        ))}
      </ul>

      {(onKnowledge || (canManage && replies.length > 0)) && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-[11.5px]">
          {onKnowledge ? (
            <button type="button" onClick={onKnowledge} className="flex items-center gap-1 font-semibold text-text-2 hover:text-brand-text">
              <BookOpen className="h-3.5 w-3.5" strokeWidth={1.7} />
              Buscar en Conocimientos
            </button>
          ) : (
            <span />
          )}
          {canManage && replies.length > 0 && (
            <Link href="/settings/quick-replies" className="text-text-3 underline-offset-2 hover:text-brand-text hover:underline">
              Administrar
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
