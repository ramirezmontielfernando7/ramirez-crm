"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, FileText, Search, X } from "lucide-react";
import type { KnowledgeEntryDto } from "@/lib/knowledge";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";

/**
 * 024 — Buscador de Conocimientos para un editor de mensajes.
 *
 * Independiente del canal a propósito: solo devuelve la entrada y QUÉ hacer
 * con ella; quien lo monta decide cómo se entrega. Hoy lo usa el editor de la
 * Bandeja (WhatsApp y canales); el chat interno, cuando exista, lo monta
 * igual y entrega con su variante de `KnowledgeTarget`
 * (`src/server/knowledge/deliver.ts`).
 */
export type KnowledgePickAction = "text" | "file" | "insert";

export function KnowledgePicker({
  busy,
  onPick,
  onClose,
}: {
  busy: boolean;
  onPick: (entry: KnowledgeEntryDto, action: KnowledgePickAction) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<KnowledgeEntryDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void fetchJson<{ entries: KnowledgeEntryDto[] }>(
        `/api/knowledge?${new URLSearchParams(query.trim() ? { q: query.trim() } : {})}`
      ).then((res) => {
        if (cancelled) return;
        setLoaded(true);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setError(null);
        setEntries(res.data.entries);
        setActive(0);
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  /** Enter: lo más natural para la entrada — su texto, o su archivo si no tiene. */
  function pickDefault(e: KnowledgeEntryDto) {
    onPick(e, e.body ? "text" : "file");
  }

  const btn =
    "rounded-full border border-border-strong bg-background px-2.5 py-1 text-[11.5px] font-semibold text-text-2 transition-colors hover:border-brand hover:bg-brand-tint hover:text-brand-text disabled:opacity-40";

  return (
    <div
      role="dialog"
      aria-label="Conocimientos"
      className="mb-2.5 rounded-md border bg-subtle p-2.5"
    >
      <div className="mb-2 flex items-center gap-2">
        <BookOpen className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.7} />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-3" strokeWidth={1.7} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, entries.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const entry = entries[active];
                if (entry && !busy) pickDefault(entry);
              }
            }}
            placeholder="Buscar en Conocimientos…"
            aria-label="Buscar en Conocimientos"
            className="w-full rounded-md border border-border-strong bg-background py-1.5 pl-7 pr-2.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
          />
        </div>
        <button onClick={onClose} aria-label="Cerrar Conocimientos" className="rounded p-1 text-text-3 hover:bg-secondary">
          <X className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>

      {error && <p className="px-1 text-xs text-destructive">{error}</p>}
      {loaded && !error && entries.length === 0 && (
        <p className="px-1 py-2 text-xs text-text-3">
          {query.trim() ? "Nada coincide con la búsqueda." : "Aún no hay entradas en Conocimientos."}
        </p>
      )}

      <ul className="max-h-[240px] space-y-1 overflow-y-auto" role="listbox" aria-label="Resultados">
        {entries.map((e, i) => (
          <li
            key={e.id}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            className={cn(
              "rounded-md border bg-background px-2.5 py-2",
              i === active ? "border-brand" : "border-transparent"
            )}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{e.title}</p>
                {e.body && <p className="line-clamp-1 text-xs text-text-3">{e.body}</p>}
                {e.file && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-text-2">
                    <FileText className="h-3.5 w-3.5 text-brand" strokeWidth={1.7} />
                    <span className="truncate">{e.file.name}</span>
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {e.body && (
                  <button className={btn} disabled={busy} onClick={() => onPick(e, "text")}>
                    Enviar texto
                  </button>
                )}
                {e.file && (
                  <button className={btn} disabled={busy} onClick={() => onPick(e, "file")}>
                    Enviar archivo
                  </button>
                )}
                {e.body && (
                  <button className={btn} disabled={busy} onClick={() => onPick(e, "insert")} title="Ponerlo en el editor para revisarlo antes de enviar">
                    Insertar
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
