"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, Search, Sparkles } from "lucide-react";
import { MODULES } from "@/lib/modules/registry";
import { availableSections } from "@/lib/modules/nav-layout";
import {
  OPEN_ASSISTANT_EVENT,
  OPEN_PALETTE_EVENT,
  isPaletteShortcut,
  matchPages,
  type PalettePage,
} from "@/lib/command-palette";
import type { ConversationDto } from "@/lib/types";
import { contactLabel } from "@/lib/phone-search";
import { ContactAvatar } from "@/components/avatar";
import { useViewer } from "@/components/viewer-context";
import { cn } from "@/lib/utils";

/**
 * Auditoría UX 2026-11 (paquete C, punto 4) — «Buscar» con Ctrl/⌘ K desde
 * cualquier pantalla: chats por nombre o teléfono (con el mismo filtro de la
 * Bandeja: el asesor solo ve lo suyo), pantallas a las que tiene acceso y,
 * con el Asistente, «Preguntar al asistente». Antes el atajo solo abría el
 * asistente y en Esencial no hacía nada.
 */

type Item =
  | { kind: "chat"; id: string; c: ConversationDto }
  | { kind: "page"; id: string; page: PalettePage }
  | { kind: "ask"; id: string; q: string };

const SETTINGS_PAGES: { label: string; href: string; permission: Parameters<ReturnType<typeof useViewer>["can"]>[0] }[] = [
  { label: "Conectar WhatsApp", href: "/settings/whatsapp", permission: "settings.manage" },
  { label: "Equipo y accesos", href: "/settings/team", permission: "settings.manage" },
  { label: "Etiquetas", href: "/settings/tags", permission: "settings.manage" },
  { label: "Personalización", href: "/settings/personalization", permission: "settings.manage" },
];

export function CommandPalette() {
  const viewer = useViewer();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [chats, setChats] = useState<ConversationDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const canInbox = viewer.hasModule("inbox");
  const canAsk = viewer.hasModule("asistente") && viewer.can("assistant.use");

  const pages = useMemo<PalettePage[]>(() => {
    const has = { has: (k: Parameters<typeof viewer.hasModule>[0]) => viewer.hasModule(k) };
    const out: PalettePage[] = [];
    for (const def of MODULES) {
      if (!def.sections) continue;
      for (const s of availableSections(def, has, viewer.can)) {
        out.push({ label: s.label, href: s.route, group: def.label, keywords: def.aka });
      }
    }
    for (const s of SETTINGS_PAGES) if (viewer.can(s.permission)) out.push({ label: s.label, href: s.href, group: "Ajustes" });
    return out;
  }, [viewer]);

  const show = useCallback(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    setOpen(true);
    setQ("");
    setChats([]);
    setActive(0);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    restoreFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isPaletteShortcut(e)) {
        e.preventDefault();
        if (open) close();
        else show();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, show);
    };
  }, [open, show, close]);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  // Chats: pregunta al servidor con un respiro, como la búsqueda de la Bandeja.
  useEffect(() => {
    if (!open || !canInbox) return;
    const term = q.trim();
    if (term.length < 2) {
      setChats([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/conversations?${new URLSearchParams({ q: term, limit: "6" })}`).catch(() => null);
      const data = res?.ok ? ((await res.json().catch(() => null)) as { conversations?: ConversationDto[] } | null) : null;
      if (cancelled) return;
      setSearching(false);
      setChats(data?.conversations?.slice(0, 6) ?? []);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open, canInbox]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim();
    const list: Item[] = chats.map((c) => ({ kind: "chat", id: `c:${c.id}`, c }));
    for (const p of matchPages(term, pages, term ? 6 : 8)) list.push({ kind: "page", id: `p:${p.href}`, page: p });
    if (canAsk && term) list.push({ kind: "ask", id: "ask", q: term });
    return list;
  }, [chats, pages, q, canAsk]);

  useEffect(() => setActive(0), [q, chats.length]);

  function run(item: Item | undefined) {
    if (!item) return;
    setOpen(false);
    if (item.kind === "chat") router.push(`/inbox?contact=${encodeURIComponent(item.c.contact.id)}`);
    else if (item.kind === "page") router.push(item.page.href);
    // El panel rápido del asistente, con la pregunta ya escrita (Enter la manda).
    else window.dispatchEvent(new CustomEvent(OPEN_ASSISTANT_EVENT, { detail: { question: item.q } }));
  }

  if (!open) return null;

  const chatItems = items.filter((i) => i.kind === "chat");
  const pageItems = items.filter((i) => i.kind === "page");
  const askItem = items.find((i) => i.kind === "ask");
  const indexOf = (it: Item) => items.indexOf(it);
  const optionId = (it: Item) => `palette-opt-${indexOf(it)}`;

  const row = (it: Item, children: React.ReactNode) => (
    <li
      key={it.id}
      id={optionId(it)}
      role="option"
      aria-selected={indexOf(it) === active}
      onMouseMove={() => setActive(indexOf(it))}
      onClick={() => run(it)}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-[13.5px]",
        indexOf(it) === active ? "bg-[var(--accent-wash)]" : "hover:bg-row-hover",
      )}
    >
      {children}
      {indexOf(it) === active && <CornerDownLeft className="ml-auto h-3.5 w-3.5 shrink-0 text-text-3" aria-hidden />}
    </li>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-overlay px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar"
        data-testid="command-palette"
        className="flex max-h-[min(560px,76vh)] w-full max-w-[600px] flex-col overflow-hidden rounded-xl bg-surface shadow-pop ring-1 ring-border"
      >
        <div className="flex items-center gap-2.5 border-b px-4">
          <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.8} aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(items[active]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? optionId(items[active]!) : undefined}
            placeholder={canInbox ? "Busca un chat, un teléfono o una pantalla…" : "Busca una pantalla…"}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-text-3"
          />
          <kbd className="rounded border px-1.5 py-0.5 font-mono text-[10.5px] text-text-3">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" aria-label="Resultados" className="min-h-0 flex-1 overflow-y-auto p-2">
          {chatItems.length > 0 && <GroupLabel>Chats</GroupLabel>}
          {chatItems.map((it) =>
            it.kind === "chat"
              ? row(
                  it,
                  <>
                    <ContactAvatar name={contactLabel(it.c.contact)} seed={it.c.contact.id} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{contactLabel(it.c.contact)}</span>
                      {it.c.preview && <span className="block truncate text-[12px] text-text-3">{it.c.preview}</span>}
                    </span>
                  </>,
                )
              : null,
          )}
          {canInbox && q.trim().length >= 2 && !searching && chatItems.length === 0 && pageItems.length === 0 && (
            <li className="px-3 py-2 text-[12.5px] text-text-3">Ningún chat coincide con «{q.trim()}».</li>
          )}
          {pageItems.length > 0 && <GroupLabel>Pantallas</GroupLabel>}
          {pageItems.map((it) =>
            it.kind === "page"
              ? row(
                  it,
                  <>
                    <ArrowRight className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.8} aria-hidden />
                    <span className="truncate">
                      {it.page.label}
                      <span className="text-text-3"> · {it.page.group}</span>
                    </span>
                  </>,
                )
              : null,
          )}
          {askItem &&
            askItem.kind === "ask" &&
            [<GroupLabel key="ask-label">Asistente</GroupLabel>,
            row(
              askItem,
              <>
                <Sparkles className="h-4 w-4 shrink-0 text-brand-text" strokeWidth={1.8} aria-hidden />
                <span className="truncate">
                  Preguntar al asistente: <span className="font-medium">«{askItem.q}»</span>
                </span>
              </>,
            )]}
          {items.length === 0 && !canInbox && (
            <li className="px-3 py-6 text-center text-[13px] text-text-3">Sin resultados.</li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
      {children}
    </li>
  );
}
