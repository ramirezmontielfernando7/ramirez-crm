"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Search, X } from "lucide-react";

/**
 * Ronda 3 — El buscador de la columna de chats, siempre a la vista: 36 px,
 * borde fuerte y radio de control, como `.search` de la maqueta. «/» lo
 * enfoca desde cualquier parte de la Bandeja (salvo escribiendo en otro
 * campo). `hint` recuerda el filtro puesto, para que la búsqueda no parezca
 * ser sobre todo.
 */
export const ListSearch = forwardRef<
  HTMLInputElement,
  {
    query: string;
    onQuery: (q: string) => void;
    placeholder: string;
    label?: string;
    hint?: string | null;
    autoFocus?: boolean;
    onClose?: () => void;
  }
>(function ListSearch({ query, onQuery, placeholder, label = "Buscar conversación", hint, autoFocus, onClose }, ref) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current as HTMLInputElement);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <label className="flex h-9 items-center gap-2 rounded-control border border-border-strong bg-surface px-3 text-text-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-soft">
      <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <input
        ref={input}
        autoFocus={autoFocus}
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.preventDefault();
            onQuery("");
          } else if (e.key === "Escape") onClose?.();
        }}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-text-3 [&::-webkit-search-cancel-button]:hidden"
      />
      {hint && <span className="cap shrink-0">{hint}</span>}
      {query && (
        <button
          type="button"
          onClick={() => onQuery("")}
          aria-label="Borrar búsqueda"
          className="rounded p-0.5 text-text-3 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </label>
  );
});
