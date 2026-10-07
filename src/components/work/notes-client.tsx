"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Lock, MessageCircle, Pin, PinOff, Plus, StickyNote, Trash2, Users, X } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import {
  NOTE_BODY_MAX,
  NOTE_COLOR_LABEL,
  NOTE_COLORS,
  NOTE_TITLE_MAX,
  NOTE_VISIBILITY_HINT,
  type NoteColor,
  type NoteDto,
} from "@/lib/work";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ContactSearch } from "./contact-search";

/**
 * 033, PR 2 — Notas, como Google Keep: tarjetas de colores (las fijadas
 * arriba) y, al tocar una, su detalle a la derecha (en el celular, encima).
 * Aquí están las que escribió quien mira; las del equipo se ven en cada chat
 * («Notas de trabajo» del panel del contacto). Son internas: nunca se envían.
 */

type DraftLink = { contactId: string; conversationId: string | null; name: string };
type Selected = { kind: "note"; note: NoteDto } | { kind: "new"; link: DraftLink | null } | null;

const PILL =
  "box-border h-7 shrink-0 rounded-full border px-3 text-[12px] font-semibold leading-none transition-colors";

/** Fondo de una nota (tokens de globals.css, claro y oscuro). */
export function noteBackground(color: NoteColor): string | undefined {
  return color === "ninguno" ? undefined : `var(--note-${color})`;
}

export function NotesClient({ initialNoteId, draftLink }: { initialNoteId: string | null; draftLink: DraftLink | null }) {
  const [archived, setArchived] = useState(false);
  const [notes, setNotes] = useState<NoteDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(draftLink ? { kind: "new", link: draftLink } : null);
  const seq = useRef(0);

  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    const res = await fetchJson<{ notes: NoteDto[] }>(`/api/work/notes${archived ? "?archived=1" : ""}`);
    if (mine !== seq.current) return;
    setLoaded(true);
    if (!res.ok) {
      setError(`No se pudieron cargar las notas: ${res.error}`);
      return;
    }
    setError(null);
    setNotes(res.data.notes);
  }, [archived]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  // `?nota=<id>`: abrir esa nota (también la de un chat, si se puede ver).
  useEffect(() => {
    if (!initialNoteId) return;
    void fetchJson<{ note: NoteDto }>(`/api/work/notes/${encodeURIComponent(initialNoteId)}`).then((res) => {
      if (res.ok) setSelected({ kind: "note", note: res.data.note });
      else setError(res.status === 404 ? "Esa nota no existe o no la puedes ver" : res.error);
    });
  }, [initialNoteId]);

  function replace(note: NoteDto) {
    setNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)));
    setSelected((s) => (s?.kind === "note" && s.note.id === note.id ? { kind: "note", note } : s));
  }

  const pinned = notes.filter((n) => n.pinned);
  const others = notes.filter((n) => !n.pinned);
  const panelOpen = selected !== null;
  const activeId = selected?.kind === "note" ? selected.note.id : null;

  return (
    <div className="flex h-full min-h-0">
      <section
        className={cn("flex min-h-0 min-w-0 flex-1 flex-col", panelOpen && "max-md:hidden")}
        aria-label="Notas"
        aria-busy={!loaded}
      >
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2 pt-3 sm:px-6">
          {([false, true] as const).map((a) => (
            <button
              key={String(a)}
              onClick={() => setArchived(a)}
              aria-pressed={archived === a}
              className={cn(PILL, archived === a ? "border-brand bg-brand-veil text-foreground" : "text-text-3 hover:bg-accent")}
            >
              {a ? "Archivadas" : "Notas"}
            </button>
          ))}
          <Button size="sm" className="ml-auto" onClick={() => setSelected({ kind: "new", link: null })}>
            <Plus className="mr-1 h-4 w-4" strokeWidth={1.8} />
            Nueva nota
          </Button>
        </div>
        <p className="px-4 pb-2 text-[12px] text-text-3 sm:px-6">
          Aquí están las notas que escribiste. Las del equipo sobre un cliente se ven en su chat, en «Notas de trabajo».
        </p>

        {error && (
          <p role="alert" className="mx-4 mb-2 rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text sm:mx-6">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
          {loaded && notes.length === 0 ? (
            <div className="mx-auto mt-14 max-w-xs text-center">
              <StickyNote className="mx-auto mb-3 h-8 w-8 text-text-3" strokeWidth={1.5} />
              <p className="font-semibold">{archived ? "Nada archivado" : "Aún no tienes notas"}</p>
              <p className="mt-1 text-sm text-text-3">
                {archived ? "Las notas que archives se guardan aquí." : "Toca «Nueva nota» o crea una desde un chat de la Bandeja."}
              </p>
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <>
                  <p className="kicker mb-2 mt-1">Fijadas</p>
                  <NoteGrid notes={pinned} activeId={activeId} onOpen={(n) => setSelected({ kind: "note", note: n })} />
                  {others.length > 0 && <p className="kicker mb-2 mt-5">Otras</p>}
                </>
              )}
              <NoteGrid notes={others} activeId={activeId} onOpen={(n) => setSelected({ kind: "note", note: n })} />
            </>
          )}
        </div>
      </section>

      {panelOpen && (
        <section className="min-h-0 w-full md:w-[440px] md:shrink-0 md:border-l" aria-label="Detalle de la nota">
          {selected.kind === "new" ? (
            <NoteEditor
              key={`new-${selected.link?.contactId ?? ""}`}
              note={null}
              link={selected.link}
              onClose={() => setSelected(null)}
              onSaved={(n) => {
                setSelected({ kind: "note", note: n });
                void refetch();
              }}
              onRemoved={() => undefined}
              justCreated={false}
            />
          ) : (
            <NoteEditor
              key={selected.note.id}
              note={selected.note}
              link={null}
              onClose={() => setSelected(null)}
              onSaved={(n) => {
                replace(n);
                void refetch();
              }}
              onRemoved={() => {
                setSelected(null);
                void refetch();
              }}
              justCreated={Date.now() - new Date(selected.note.createdAt).getTime() < 3000}
            />
          )}
        </section>
      )}
    </div>
  );
}

function NoteGrid({ notes, activeId, onOpen }: { notes: NoteDto[]; activeId: string | null; onOpen: (n: NoteDto) => void }) {
  if (notes.length === 0) return null;
  return (
    <ul className="columns-1 gap-3 sm:columns-2 xl:columns-3">
      {notes.map((n) => (
        <li key={n.id} className="mb-3 break-inside-avoid">
          <NoteCard note={n} active={n.id === activeId} onOpen={() => onOpen(n)} />
        </li>
      ))}
    </ul>
  );
}

/** Una tarjeta; también la usa «Notas de trabajo» del chat. */
export function NoteCard({ note, active, onOpen, compact = false }: { note: NoteDto; active?: boolean; onOpen?: () => void; compact?: boolean }) {
  const inner = (
    <>
      <span className="flex items-start gap-2">
        {note.title && <span className="min-w-0 flex-1 break-words font-semibold leading-snug">{note.title}</span>}
        {note.pinned && <Pin className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={2} aria-label="Fijada" />}
      </span>
      {note.body && (
        <span className={cn("mt-1 block whitespace-pre-line break-words text-[13.5px] text-text-2", compact ? "line-clamp-3" : "line-clamp-[10]")}>
          {note.body}
        </span>
      )}
      <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-text-3">
        {/* En el chat (compacta) sobra el contacto: se dice quién la escribió. */}
        {compact ? (
          note.author && <span>Escrita por {note.author.name}</span>
        ) : note.contact ? (
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="h-3 w-3" strokeWidth={2} />
            {note.contact.name}
          </span>
        ) : !note.hiddenContact ? (
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3" strokeWidth={2} />
            Solo tú
          </span>
        ) : null}
      </span>
    </>
  );
  const cls = cn(
    "block w-full rounded-lg border p-3 text-left transition-shadow hover:shadow-sm",
    note.color === "ninguno" && "bg-card",
    active && "ring-2 ring-brand"
  );
  const style = { background: noteBackground(note.color) };
  return onOpen ? (
    <button onClick={onOpen} className={cls} style={style}>
      {inner}
    </button>
  ) : (
    <div className={cls} style={style}>
      {inner}
    </div>
  );
}

function NoteEditor({
  note,
  link,
  onClose,
  onSaved,
  onRemoved,
  justCreated,
}: {
  note: NoteDto | null;
  link: DraftLink | null;
  onClose: () => void;
  onSaved: (n: NoteDto) => void;
  onRemoved: () => void;
  justCreated: boolean;
}) {
  const editable = note ? note.canEdit : true;
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [color, setColor] = useState<NoteColor>(note?.color ?? "ninguno");
  const [contact, setContact] = useState<{ id: string; name: string; conversationId: string | null } | null>(
    note?.contact
      ? { ...note.contact, conversationId: note.conversationId }
      : link
        ? { id: link.contactId, name: link.name, conversationId: link.conversationId }
        : null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(justCreated);

  async function send(path: string, method: "POST" | "PATCH", payload: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    const res = await fetchJson<{ note: NoteDto }>(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    return res.data.note;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() && !body.trim()) {
      setError("Escribe algo en la nota");
      return;
    }
    const payload: Record<string, unknown> = { title: title.trim() || null, body, color };
    const contactChanged = (contact?.id ?? null) !== (note?.contact?.id ?? null);
    // Una nota ligada a un contacto que quien edita no ve conserva su ligadura.
    if (!note || contactChanged) {
      if (contact?.conversationId) payload.conversationId = contact.conversationId;
      else payload.contactId = contact?.id ?? null;
    }
    const n = await send(note ? `/api/work/notes/${note.id}` : "/api/work/notes", note ? "PATCH" : "POST", payload);
    if (!n) return;
    setSaved(true);
    onSaved(n);
  }

  async function toggle(field: "pinned" | "archived") {
    if (!note) return;
    const n = await send(`/api/work/notes/${note.id}`, "PATCH", { [field]: !note[field] });
    if (!n) return;
    if (field === "archived") onRemoved();
    else onSaved(n);
  }

  async function remove() {
    if (!note || !window.confirm("¿Borrar esta nota? No se puede deshacer.")) return;
    const res = await fetchJson(`/api/work/notes/${note.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onRemoved();
  }

  return (
    <form onSubmit={save} className="flex h-full min-h-0 flex-col" style={{ background: noteBackground(color) }}>
      <div className="flex items-center gap-1 border-b px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="-ml-1.5 rounded-full p-1.5 text-text-3 hover:bg-accent hover:text-foreground"
          aria-label="Cerrar nota"
        >
          <X className="h-4 w-4" />
        </button>
        <p className="ml-1 text-sm font-semibold">{note ? "Nota" : "Nueva nota"}</p>
        <div className="ml-auto flex items-center gap-0.5">
          {note && editable && (
            <>
              <IconButton label={note.pinned ? "Dejar de fijar" : "Fijar arriba"} onClick={() => void toggle("pinned")}>
                {note.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </IconButton>
              <IconButton label={note.archived ? "Sacar del archivo" : "Archivar"} onClick={() => void toggle("archived")}>
                {note.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </IconButton>
              <IconButton label="Borrar nota" onClick={() => void remove()} danger>
                <Trash2 className="h-4 w-4" strokeWidth={1.7} />
              </IconButton>
            </>
          )}
          {editable && (
            <Button type="submit" size="sm" disabled={saving} className="ml-1">
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <fieldset disabled={!editable} className="flex flex-col gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={NOTE_TITLE_MAX}
            placeholder="Título (opcional)"
            aria-label="Título"
            className="w-full bg-transparent text-[18px] font-semibold tracking-tight outline-none placeholder:text-text-3"
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={NOTE_BODY_MAX}
            placeholder="Escribe una nota…"
            aria-label="Nota"
            autoFocus={!note}
            rows={9}
            className="border-transparent bg-transparent px-0 shadow-none focus-visible:border-transparent focus-visible:ring-0"
          />

          <div role="radiogroup" aria-label="Color" className="flex flex-wrap items-center gap-2">
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={NOTE_COLOR_LABEL[c]}
                title={NOTE_COLOR_LABEL[c]}
                onClick={() => setColor(c)}
                className={cn(
                  "h-7 w-7 rounded-full border transition-shadow",
                  c === "ninguno" && "bg-card",
                  color === c ? "ring-2 ring-brand ring-offset-2 ring-offset-background" : "hover:shadow"
                )}
                style={{ background: noteBackground(c) }}
              />
            ))}
          </div>

          <div className="mt-1 flex flex-col gap-1.5">
            <span className="kicker">Chat</span>
            {note?.hiddenContact && !contact ? (
              <p className="text-sm text-text-3">Ligada a un contacto que no tienes asignado.</p>
            ) : contact ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-2.5 py-1 text-[12.5px] font-semibold text-brand-text">
                  <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
                  {contact.name}
                  {editable && (
                    <button
                      type="button"
                      onClick={() => setContact(null)}
                      aria-label="Quitar el chat"
                      className="-mr-1 rounded-full p-0.5 hover:bg-brand-veil"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
                <Link
                  href={`/inbox?contact=${encodeURIComponent(contact.id)}`}
                  className="text-sm text-brand-text underline-offset-2 hover:underline"
                >
                  Abrir chat
                </Link>
              </div>
            ) : (
              <ContactSearch onPick={(c) => setContact({ ...c, conversationId: null })} />
            )}
            {/* Quién la ve, en sencillo (pedido del dueño). */}
            <p className="flex items-start gap-1.5 text-[12px] leading-snug text-text-2" role="note">
              {contact || note?.hiddenContact ? (
                <Users className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              ) : (
                <Lock className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              )}
              {contact || note?.hiddenContact ? NOTE_VISIBILITY_HINT : "Solo tú ves esta nota. Si la ligas a un chat, la verá todo el equipo que puede ver ese contacto."}
            </p>
          </div>

          {note?.author && (
            <p className="font-mono text-[10.5px] tracking-[0.04em] text-text-3">Escrita por {note.author.name}</p>
          )}
          {error && (
            <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          )}
          {saved && !error && (
            <p role="status" className="text-sm text-success-text">
              Guardada · solo para el equipo, nunca se envía al cliente
            </p>
          )}
        </fieldset>
      </div>
    </form>
  );
}

function IconButton({ label, onClick, danger = false, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-full p-1.5 text-text-3",
        danger ? "hover:bg-danger-tint hover:text-danger-text" : "hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
