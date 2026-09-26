"use client";

import { useEffect, useRef, useState } from "react";
import { m } from "motion/react";
import { MessageCircle, Search } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { fetchJson } from "@/lib/fetch-json";
import { matchesQuery } from "@/lib/search";
import { SPRING } from "@/components/motion";

/**
 * 026 — Buscador de chats de CLIENTE para mencionarlos en el chat de equipo.
 * Solo lista los que quien escribe puede ver (la Bandeja ya viene filtrada
 * por `scopedContacts`); el servidor lo vuelve a validar al publicar.
 */
export function MentionPicker({
  onPick,
  onClose,
}: {
  onPick: (conversationId: string, name: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [chats, setChats] = useState<ConversationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ conversations: ConversationDto[] }>("/api/conversations").then((res) => {
      if (cancelled) return;
      if (res.ok) setChats(res.data.conversations);
      else setError(`No se pudieron cargar los chats: ${res.error}`);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const shown = (chats ?? [])
    .filter((c) => matchesQuery(query, { text: [c.contact.name], phone: c.contact.phone ?? undefined }))
    .slice(0, 30);

  return (
    <m.div
      ref={ref}
      role="dialog"
      aria-label="Mencionar un chat de cliente"
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.1 } }}
      transition={SPRING}
      style={{ transformOrigin: "bottom left" }}
      className="absolute bottom-full left-0 z-30 mb-2.5 w-72 overflow-hidden rounded-md border bg-popover text-foreground shadow-pop"
    >
      <div className="flex items-center gap-2 border-b px-2.5 py-2">
        <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.7} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar un chat de cliente…"
          aria-label="Buscar un chat de cliente"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-3 max-sm:text-base"
        />
      </div>
      {error && (
        <p role="alert" className="px-3 py-2 text-[12px] text-danger-text">
          {error}
        </p>
      )}
      <ul className="max-h-64 overflow-y-auto py-1">
        {chats === null && !error && <li className="px-3 py-2 text-xs text-text-3">Cargando…</li>}
        {chats !== null && shown.length === 0 && (
          <li className="px-3 py-2 text-xs text-text-3">{chats.length === 0 ? "No ves ningún chat de cliente" : "Ningún chat coincide"}</li>
        )}
        {shown.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c.id, c.contact.name)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-row-hover"
            >
              <MessageCircle className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.7} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.contact.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </m.div>
  );
}

/** La pastilla de una mención en una burbuja. Sin acceso, no dice de qué chat es. */
export function MentionChip({
  mention,
  onOpen,
}: {
  mention: import("@/lib/team-chat-mentions").MentionDto;
  onOpen: (contactId: string) => void;
}) {
  if (!mention.accessible) {
    return (
      <span
        title="No tienes acceso a este chat"
        className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-px align-baseline text-[12.5px] font-medium text-text-3"
      >
        @ chat sin acceso
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(mention.contactId)}
      title={`Abrir el chat de ${mention.label}`}
      className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-brand-tint px-1.5 py-px align-baseline text-[12.5px] font-semibold text-brand-text hover:underline"
    >
      @{mention.label}
    </button>
  );
}
