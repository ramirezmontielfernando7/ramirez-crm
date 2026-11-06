"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import {
  ArrowRightLeft,
  Bot,
  Kanban,
  Megaphone,
  PauseCircle,
  PlayCircle,
  StickyNote,
  Tag,
  UserRound,
  type LucideIcon,
  UserMinus,
  UserPlus,
} from "lucide-react";
import {
  describeTimelineItem,
  type TimelineItemDto,
  type TimelineKind,
} from "@/lib/timeline";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Collapse, ENTER } from "@/components/motion";

const ICON: Record<TimelineKind, LucideIcon> = {
  note: StickyNote,
  initial_note: StickyNote,
  stage: Kanban,
  assignment: ArrowRightLeft,
  ai_paused: PauseCircle,
  ai_handoff: UserRound,
  ai_resumed: PlayCircle,
  consent: Megaphone,
  tag_added: Tag,
  tag_removed: Tag,
  participant_added: UserPlus,
  participant_removed: UserMinus,
  agent_changed: Bot,
  marketing_opt_out: Megaphone,
};

/** Cuántas líneas se ven de entrada; "Ver anteriores" suma de a tantas. */
const PAGE = 8;

/**
 * 022 — Línea de tiempo del chat: todo lo que le pasó al contacto (notas,
 * etapas, asignaciones, pausas de la IA, consentimiento, etiquetas), lo más
 * reciente arriba. Cada evento es UNA línea "[acción] por [quién]" con su
 * hora; lo que trae más contenido (el texto de una nota, el motivo de una
 * pérdida) se abre en su lugar con "ver más".
 *
 * Arriba, el campo para añadir una nota: las notas ya no se sobrescriben,
 * cada una queda aquí con autor y hora.
 */
/** Ronda 3: los filtros del historial completo (Todo · Venta · IA · Notas · Equipo). */
const GROUPS = [
  ["all", "Todo"],
  ["sale", "Venta"],
  ["ai", "IA"],
  ["notes", "Notas"],
  ["team", "Equipo"],
] as const;
type Group = (typeof GROUPS)[number][0];
const GROUP_OF: Record<TimelineKind, Exclude<Group, "all">> = {
  note: "notes",
  initial_note: "notes",
  stage: "sale",
  consent: "sale",
  marketing_opt_out: "sale",
  tag_added: "sale",
  tag_removed: "sale",
  assignment: "team",
  participant_added: "team",
  participant_removed: "team",
  ai_paused: "ai",
  ai_handoff: "ai",
  ai_resumed: "ai",
  agent_changed: "ai",
};

export function ChatTimeline({
  contactId,
  refreshKey = 0,
  mode = "full",
  onSeeAll,
}: {
  contactId: string;
  /** Aumenta con cada evento SSE o cambio hecho desde el panel. */
  refreshKey?: number;
  /**
   * Ronda 3 — «preview»: la sección Historial de Detalles (los 3 últimos y
   * «Ver todo»); «full»: el panel Historial completo, con filtros y la nota.
   */
  mode?: "preview" | "full";
  onSeeAll?: () => void;
}) {
  const [group, setGroup] = useState<Group>("all");
  const [items, setItems] = useState<TimelineItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchJson<{ items: TimelineItemDto[] }>(
      `/api/contacts/${contactId}/timeline`
    );
    if (!res.ok) {
      setError(`No se pudo cargar la actividad: ${res.error}`);
      return;
    }
    setError(null);
    setItems(res.data.items);
  }, [contactId]);

  // Otro contacto: se vacía primero, para que no se asome la historia del
  // anterior mientras llega la nueva.
  useEffect(() => {
    setItems(null);
    setShown(PAGE);
    setDraft("");
    setNoteError(null);
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function addNote() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    setNoteError(null);
    const res = await fetchJson(`/api/contacts/${contactId}/notes`, jsonInit("POST", { text }));
    setSaving(false);
    if (!res.ok) {
      // El borrador se queda: perder lo escrito por un fallo sería peor.
      setNoteError(`No se guardó la nota: ${res.error}`);
      return;
    }
    setDraft("");
    await load();
  }

  if (mode === "preview") {
    const last = items?.slice(0, 3) ?? [];
    return (
      <section className="sec border-b-0" aria-label="Historial del chat">
        <h3 className="sec-h">
          Historial
          {onSeeAll && (
            <button type="button" onClick={onSeeAll} className="sec-link">
              Ver todo
            </button>
          )}
        </h3>
        {error && (
          <p role="alert" className="text-[11px] text-danger-text">
            {error}
          </p>
        )}
        {items === null && !error ? (
          <TimelineSkeleton />
        ) : last.length === 0 ? (
          <p className="text-[13px] text-text-3">Aún no hay actividad en este chat.</p>
        ) : (
          <ol>
            {last.map((item) => (
              <PreviewRow key={item.id} item={item} />
            ))}
          </ol>
        )}
      </section>
    );
  }

  const filtered = (items ?? []).filter((i) => group === "all" || GROUP_OF[i.kind] === group);
  const visible = filtered.slice(0, shown);

  return (
    <section aria-label="Actividad del chat">
      <div role="group" aria-label="Filtrar historial" className="flex flex-wrap gap-1.5 border-b px-4 py-3">
        {GROUPS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={group === id}
            onClick={() => setGroup(id)}
            className={cn(
              "inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium transition-colors",
              group === id
                ? "border-brand-soft bg-[var(--accent-wash)] text-brand-text"
                : "border-dashed border-border-strong bg-surface text-text-2 hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="p-4">

      <div className="rounded-md border bg-card p-2 focus-within:border-brand">
        <Textarea
          rows={2}
          value={draft}
          disabled={saving}
          placeholder="Escribe una nota interna…"
          aria-label="Nueva nota"
          maxLength={4000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void addNote();
            }
          }}
          className="min-h-[44px] resize-none border-0 bg-transparent p-1 text-[13px] shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-end gap-2">
          <span className="text-[10.5px] text-text-3 max-sm:hidden">Ctrl + Enter</span>
          <Button size="sm" disabled={saving || !draft.trim()} onClick={() => void addNote()}>
            {saving ? "Guardando…" : "Añadir nota"}
          </Button>
        </div>
      </div>
      {noteError && (
        <p role="alert" className="mt-1.5 text-[11px] text-danger-text">
          {noteError}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[11px] text-danger-text">
          {error}
        </p>
      )}

      {items === null && !error ? (
        <TimelineSkeleton />
      ) : filtered.length === 0 ? (
        <p className="mt-3 text-xs text-text-3">{group === "all" ? "Aún no hay actividad en este chat." : "Nada de este tipo todavía."}</p>
      ) : (
        <ol className="relative mt-3">
          {/* El hilo vertical que une los eventos. */}
          <span aria-hidden className="absolute bottom-2 left-[11px] top-2 w-px bg-border" />
          <AnimatePresence initial={false}>
            {visible.map((item, i) => (
              <TimelineRow key={item.id} item={item} index={i} />
            ))}
          </AnimatePresence>
        </ol>
      )}

      {filtered.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE * 2)}
          className="ml-8 mt-1 text-[11.5px] font-medium text-brand-text underline-offset-2 transition-transform duration-150 hover:underline active:scale-95"
        >
          Ver anteriores ({filtered.length - shown})
        </button>
      )}
      </div>
    </section>
  );
}

/** Un renglón de la sección Historial de Detalles (maqueta: círculo de 24 px, 13 px y la fecha). */
function PreviewRow({ item }: { item: TimelineItemDto }) {
  const { title } = describeTimelineItem(item);
  const Icon = ICON[item.kind];
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border bg-secondary text-text-2">
        <Icon className="h-3 w-3" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 text-[13px] leading-[18px]">
        <p className="line-clamp-2">{title}</p>
        <time dateTime={item.at} className="block text-[11px] leading-[14px] text-text-3" title={new Date(item.at).toLocaleString("es-MX")}>
          {formatWhen(item.at)}
        </time>
      </div>
    </li>
  );
}

function TimelineRow({ item, index }: { item: TimelineItemDto; index: number }) {
  const [open, setOpen] = useState(false);
  const { title, body } = describeTimelineItem(item);
  const Icon = ICON[item.kind];
  const titleRef = useRef<HTMLParagraphElement>(null);
  // "ver más" solo si hay algo que ver: contenido extra, o un título que de
  // verdad no cupo en su línea (se mide, no se adivina por largo).
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el || open) return;
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [title, open]);
  const expandable = Boolean(body) || clipped;
  const bodyId = `tl-${item.id}`;

  return (
    <m.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      // Escalonado corto: la lista "cae" en su lugar sin pasar de ~270 ms.
      transition={{ ...ENTER, delay: Math.min(index, 6) * 0.015 }}
      className="relative flex gap-2.5 pb-3 last:pb-0"
    >
      <span className="relative z-10 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border bg-background text-text-3">
        <Icon className="h-3 w-3" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1 pt-[3px]">
        <p
          ref={titleRef}
          className={cn("text-[12.5px] leading-snug text-foreground", !open && "truncate")}
          title={!open && clipped ? title : undefined}
        >
          {title}
        </p>
        <div className="flex items-baseline gap-1.5 text-[11px] text-text-3">
          <time
            dateTime={item.at}
            className="shrink-0 font-mono text-[10.5px]"
            title={new Date(item.at).toLocaleString("es-MX")}
          >
            {formatWhen(item.at)}
          </time>
          {!open && body && <span className="min-w-0 flex-1 truncate">· {body}</span>}
          {expandable && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={body ? bodyId : undefined}
              className="ml-auto shrink-0 font-medium text-brand-text underline-offset-2 transition-transform duration-150 hover:underline active:scale-95"
            >
              {open ? "ver menos" : "ver más"}
            </button>
          )}
        </div>
        <Collapse open={open && Boolean(body)} id={bodyId}>
          <p className="whitespace-pre-wrap break-words pt-1 text-[12px] leading-relaxed text-text-2">
            {body}
          </p>
        </Collapse>
      </div>
    </m.li>
  );
}

function TimelineSkeleton() {
  return (
    <div className="mt-3 space-y-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="h-[23px] w-[23px] shrink-0 animate-pulse rounded-full bg-accent" />
          <span className="h-3 flex-1 animate-pulse rounded bg-accent" />
        </div>
      ))}
    </div>
  );
}

/** Hoy: la hora. Otro día: el día y la hora ("12 sep, 10:42"). */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return `Hoy ${time}`;
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return `Ayer ${time}`;
  const day = d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  return `${day}, ${time}`;
}
