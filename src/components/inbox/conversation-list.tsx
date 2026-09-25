"use client";

import { useEffect, useRef, useState } from "react";
import { CheckSquare, Megaphone, Search, Sparkles, UserRound, X } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { etiquetaDeOrigen, titularDeOrigen } from "@/lib/anuncios";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { ChannelBadge } from "@/components/channel-badge";
import { matchesQuery } from "@/lib/search";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { formatTime, previewText } from "./helpers";
import { useViewer } from "@/components/viewer-context";
import { assignContacts, useAssignees } from "@/components/assignment/use-assignees";
import { NavRevealButton } from "@/components/nav-mode";

/* Puntos de etapa: los tokens del tema, no hex copiados del tema claro —
   así siguen al acento white-label y se recalculan en oscuro. */
const STAGE_DOT: Record<string, string> = {
  Nuevo: "var(--text-3)",
  "En conversación": "var(--accent)",
  Interesado: "var(--warning)",
  Cliente: "var(--success)",
  Perdido: "var(--danger)",
};
const STAGE_DOT_FALLBACK = "var(--text-3)";

/**
 * Foco por teclado de chips y selector: el anillo de `ui/button`, acento
 * sólido separado del control (el elegido ya ES del color del acento y un
 * anillo pegado se fundiría con él). El suave de los campos
 * (`ring-brand-soft`) queda a ~1.3:1 del fondo: aquí no hay borde que cambie
 * de color para compensarlo, y se veía menos que el del navegador.
 */
const FOCO_SEPARADO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * La base ÚNICA de los controles de la barra de filtros (cápsulas, selectores
 * y el ícono de selección): alto fijo y sin relleno vertical, así todos miden
 * lo mismo y comparten el eje aunque el contenido (un contador, la flecha
 * nativa del <select>) sea distinto o la barra envuelva a otra línea.
 */
const CONTROL_FILTRO =
  "box-border h-6 shrink-0 rounded-full border py-0 text-[11.5px] font-semibold leading-none transition-colors";

function EmptyState({ onSeeded }: { onSeeded: () => void }) {
  const [seeding, setSeeding] = useState(false);
  const [failed, setFailed] = useState(false);

  async function seed() {
    setSeeding(true);
    const res = await fetch("/api/seed/demo", { method: "POST" }).catch(
      () => null
    );
    setSeeding(false);
    if (res?.ok) onSeeded();
    else setFailed(true);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-serif text-[21px] italic leading-tight text-foreground">
        Sin conversaciones todavía
      </p>
      <p className="text-xs text-text-3">
        Cuando alguien escriba a tu número de WhatsApp, su conversación
        aparecerá aquí en tiempo real.
      </p>
      {!failed && (
        <Button
          size="sm"
          variant="outline"
          disabled={seeding}
          onClick={() => void seed()}
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.7} />
          {seeding ? "Cargando demo…" : "Cargar datos de demostración"}
        </Button>
      )}
    </div>
  );
}

export function ConversationList({
  conversations: conversationsProp,
  channels,
  selectedId,
  onSelect,
  onSeeded,
}: {
  conversations: ConversationDto[] | null;
  /** Canales encendidos en esta instancia (ADR-001). */
  channels: readonly Channel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeeded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "anuncios" | "humano">("all");
  const [stage, setStage] = useState<string>("all");
  const [inbox, setInbox] = useState<Channel | "all">("all");
  const inputRef = useRef<HTMLInputElement>(null);
  // 020: quién atiende. "all" | "mine" | "unassigned" | <userId>. Solo lo
  // ve quien ve a todo el equipo; al asesor el servidor ya le manda lo suyo.
  const viewer = useViewer();
  const seesAll = viewer.can("scope.all");
  const canAssign = viewer.can("assignment.manage");
  const assignees = useAssignees();
  const [owner, setOwner] = useState<string>("all");
  // Selección para asignar en lote.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkTo, setBulkTo] = useState<string>("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  /**
   * Rescate de lo tecleado ANTES de que hidratara el JS. La caja se pinta en
   * el HTML del servidor, así que se puede escribir en ella mientras carga la
   * página; al montar, React la dejaba vacía y esas pulsaciones se perdían en
   * silencio (el usuario veía la lista entera "sin filtrar"). Por eso el input
   * es NO controlado: el DOM manda y aquí solo adoptamos su valor.
   */
  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed) setQuery(typed);
  }, []);

  const loading = conversationsProp === null;
  const conversations = conversationsProp ?? [];
  // Solo NOMBRE y TELÉFONO, como cualquier filtro de contactos. Antes también
  // miraba el preview, y como el agente nombra al dueño en sus propios
  // mensajes, buscar ese nombre devolvía media bandeja. Encima era una
  // búsqueda de mensajes a medias: solo el último de cada hilo, no el historial.
  const searched = conversations.filter(
    (c) =>
      matchesQuery(query, {
        text: [c.contact.name],
        phone: c.contact.phone,
      }) &&
      (stage === "all" || c.stageName === stage) &&
      (owner === "all" ||
        (owner === "mine" && c.assignee?.id === viewer.userId) ||
        (owner === "unassigned" && !c.assignee) ||
        c.assignee?.id === owner)
  );
  // La bandeja elegida es el filtro de AFUERA: "Todas" y "No leídas" cuentan
  // dentro de ella, no sobre la suma de los dos canales.
  const inInbox =
    inbox === "all" ? searched : searched.filter((c) => c.channel === inbox);
  const inboxCount = (ch: Channel) =>
    searched.filter((c) => c.channel === ch).length;
  const unreadCount = inInbox.filter((c) => c.unreadCount > 0).length;
  // 018: las que abrió un anuncio (o una publicación con botón de WhatsApp).
  const deAnuncios = inInbox.filter((c) => c.anuncio !== null);
  const visibleBase =
    filter === "unread"
      ? inInbox.filter((c) => c.unreadCount > 0)
      : filter === "anuncios"
        ? deAnuncios
        : inInbox;
  // Sin ninguna conversación de anuncio el filtro no aparece: a quien no
  // anuncia no se le pinta un botón que siempre dice 0. Si está elegido, se
  // queda, para poder salir de él aunque el contador baje a cero.
  // 020: los chats que esperan a una persona (la IA hizo handoff).
  const humanos = inInbox.filter((c) => c.handoffAt !== null);
  const visible = filter === "humano" ? humanos : visibleBase;
  const filtros: { id: typeof filter; label: string; count: number }[] = [
    { id: "all", label: "Todas", count: inInbox.length },
    { id: "unread", label: "No leídas", count: unreadCount },
  ];
  if (humanos.length > 0 || filter === "humano") {
    filtros.push({ id: "humano", label: "Atención humana", count: humanos.length });
  }
  if (deAnuncios.length > 0 || filter === "anuncios") {
    filtros.push({ id: "anuncios", label: "Anuncios", count: deAnuncios.length });
  }
  // Con un solo canal encendido no hay bandejas que distinguir: ni marca en
  // los renglones ni filtro. La pantalla queda exactamente como antes de 014.
  const multiChannel = channels.length > 1;

  // Etapas presentes en la bandeja, en el orden en que llegan del pipeline.
  const stages: string[] = [];
  for (const c of conversations) {
    if (c.stageName && !stages.includes(c.stageName)) stages.push(c.stageName);
  }

  // Personas en el selector: el equipo (si se puede leer) más quien aparezca
  // asignado en la bandeja.
  const owners = new Map<string, string>();
  for (const a of assignees) owners.set(a.userId, a.name);
  for (const c of conversations) {
    if (c.assignee && !owners.has(c.assignee.id)) {
      owners.set(c.assignee.id, c.assignee.name);
    }
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setPicked(new Set());
    setBulkError(null);
  }

  async function assignPicked() {
    const contactIds = conversations
      .filter((c) => picked.has(c.id))
      .map((c) => c.contact.id);
    if (contactIds.length === 0) return;
    setBulkBusy(true);
    setBulkError(null);
    const err = await assignContacts(contactIds, bulkTo === "" ? null : bulkTo);
    setBulkBusy(false);
    if (err) {
      setBulkError(err);
      return;
    }
    stopSelecting();
    onSeeded();
  }

  function clearQuery() {
    if (inputRef.current) inputRef.current.value = "";
    setQuery("");
    inputRef.current?.focus();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 pb-3 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <NavRevealButton />
          <h2 className="text-[17px] font-bold tracking-tight">Bandeja</h2>
          <span className="font-mono text-[12px] text-text-3">{conversations.length}</span>
          {multiChannel && (
            <div className="ml-auto flex items-center gap-1">
              {channels.map((ch) => {
                const on = inbox === ch;
                return (
                  <button
                    key={ch}
                    onClick={() => setInbox(on ? "all" : ch)}
                    aria-pressed={on}
                    title={
                      on
                        ? "Ver todas las bandejas"
                        : `Ver solo ${CHANNEL_LABEL[ch]}`
                    }
                    className={cn(
                      "flex items-center gap-1 rounded-full border py-[3px] pl-[5px] pr-2 text-[11.5px] font-medium transition-colors",
                      FOCO_SEPARADO,
                      on
                        ? "border-brand bg-brand-veil text-foreground"
                        : "text-text-3 hover:bg-accent",
                      inbox !== "all" && !on && "opacity-45"
                    )}
                  >
                    <ChannelBadge
                      channel={ch}
                      className="h-[13px] w-[13px] rounded-[4px]"
                    />
                    {inboxCount(ch)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border-strong bg-chip px-3.5 py-[7px] shadow-sm transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
          <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.7} />
          <input
            ref={inputRef}
            placeholder="Buscar por nombre o teléfono…"
            aria-label="Buscar conversación"
            defaultValue=""
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3"
          />
          {query && (
            <button
              onClick={clearQuery}
              aria-label="Limpiar búsqueda"
              className="shrink-0 rounded-full p-0.5 text-text-3 hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
      </header>

      {/* Envuelve: con el filtro de anuncios, los tres botones y el selector de
          etapa no caben en una columna de 300-360 px, y el selector se
          aplastaba hasta dejar solo la flecha. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 border-b px-4 py-1.5">
        {filtros.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              CONTROL_FILTRO,
              "flex items-center gap-1 whitespace-nowrap px-2",
              FOCO_SEPARADO,
              filter === f.id
                ? "border-brand bg-brand text-brand-fg"
                : "border-border-strong bg-chip text-text-2 hover:border-text-3"
            )}
          >
            {f.label}
            <span
              className={cn(
                "rounded-full px-1 py-[2px] text-[10.5px] leading-none",
                filter === f.id ? "bg-brand-veil" : "bg-secondary text-text-3"
              )}
            >
              {f.count}
            </span>
          </button>
        ))}

        {/* Selectores e ícono de selección viajan juntos: si no caben, los
            selectores se recortan antes de que el ícono quede en otra línea. */}
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-1">
          {stages.length > 0 && (
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              aria-label="Filtrar por etapa del embudo"
              className={cn(
                CONTROL_FILTRO,
                "min-w-0 max-w-[9.5rem] shrink truncate px-1.5",
                FOCO_SEPARADO,
                stage === "all"
                  ? "border-border-strong bg-chip text-text-2 hover:border-text-3"
                  : "border-brand bg-brand text-brand-fg"
              )}
            >
              <option value="all">Toda etapa</option>
              {stages.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}

          {seesAll && (
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              aria-label="Filtrar por persona asignada"
              className={cn(
                CONTROL_FILTRO,
                "min-w-0 max-w-[9.5rem] shrink truncate px-1.5",
                FOCO_SEPARADO,
                owner === "all"
                  ? "border-border-strong bg-chip text-text-2 hover:border-text-3"
                  : "border-brand bg-brand text-brand-fg"
              )}
            >
              <option value="all">Todo el equipo</option>
              <option value="mine">Míos</option>
              <option value="unassigned">Sin asignar</option>
              {[...owners].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}

          {canAssign && !selecting && (
            <button
              onClick={() => setSelecting(true)}
              aria-label="Seleccionar varios"
              title="Seleccionar varios"
              className={cn(
                CONTROL_FILTRO,
                "flex w-6 items-center justify-center border-border-strong bg-chip text-text-2 transition-[border-color,transform] duration-150 hover:border-text-3 active:scale-90",
                FOCO_SEPARADO
              )}
            >
              <CheckSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      {selecting && (
        <div className="space-y-2 border-b bg-subtle px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-semibold">
              {picked.size === 1 ? "1 seleccionado" : `${picked.size} seleccionados`}
            </span>
            <Button size="sm" variant="ghost" onClick={stopSelecting}>
              Cancelar
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={bulkTo}
              onChange={(e) => setBulkTo(e.target.value)}
              aria-label="Asignar seleccionados a"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-[12.5px]"
            >
              <option value="">Sin asignar</option>
              {assignees.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={picked.size === 0 || bulkBusy}
              onClick={() => void assignPicked()}
            >
              {bulkBusy ? "Asignando…" : "Asignar"}
            </Button>
          </div>
          {bulkError && <p className="text-[11px] text-danger-text">{bulkError}</p>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-center text-xs text-text-3">Cargando…</p>
        ) : conversations.length === 0 ? (
          <EmptyState onSeeded={onSeeded} />
        ) : visible.length === 0 ? (
          <p className="p-6 text-center text-xs text-text-3">
            Sin resultados para este filtro.
          </p>
        ) : (
          <ul>
            {visible.map((c) => {
              const unread = c.unreadCount > 0;
              const active = selectedId === c.id;
              return (
                <li key={c.id} className="relative border-b border-border">
                  {active && (
                    <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" />
                  )}
                  <button
                    onClick={() => (selecting ? togglePick(c.id) : onSelect(c.id))}
                    aria-pressed={selecting ? picked.has(c.id) : undefined}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-4 py-[var(--row-py)] text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      active ? "bg-[var(--bg-active)]" : "hover:bg-row-hover"
                    )}
                  >
                    {selecting && (
                      <input
                        type="checkbox"
                        readOnly
                        tabIndex={-1}
                        checked={picked.has(c.id)}
                        aria-label={`Seleccionar a ${c.contact.name}`}
                        className="mt-2 h-4 w-4 shrink-0 accent-[var(--accent)]"
                      />
                    )}
                    <span className="relative shrink-0">
                      <ContactAvatar name={c.contact.name} seed={c.contact.id} size="list" />
                      {c.windowOpen && (
                        <span className="absolute -bottom-px -right-px h-[9px] w-[9px] rounded-full border-2 border-background bg-success" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {multiChannel && <ChannelBadge channel={c.channel} />}
                          <span
                            className={cn(
                              "truncate text-sm",
                              unread ? "font-[680]" : "font-semibold"
                            )}
                          >
                            {c.contact.name}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "shrink-0 font-mono text-[10.5px] tracking-[0.02em]",
                            unread ? "font-semibold text-brand-ink" : "text-text-3"
                          )}
                        >
                          {formatTime(c.lastMessageAt)}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-[13px]",
                            unread ? "font-medium text-text-2" : "text-text-3"
                          )}
                        >
                          {previewText(c.preview)}
                        </span>
                        {unread && (
                          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-fg">
                            {c.unreadCount}
                          </span>
                        )}
                      </span>
                      {/* Envuelve: con el asignado (020) los chips ya no caben
                          siempre en una línea de 300-360 px. */}
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {c.stageName && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-chip px-1.5 py-px text-[10.5px] leading-4 font-medium text-text-2">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{
                                background: STAGE_DOT[c.stageName] ?? STAGE_DOT_FALLBACK,
                              }}
                            />
                            {c.stageName}
                          </span>
                        )}
                        {c.handoffAt && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-warning-soft bg-warning-tint px-1.5 py-px text-[10.5px] leading-4 text-warning-text">
                            <UserRound className="h-2.5 w-2.5" strokeWidth={1.8} />
                            {/* 020: al asesor asignado se le dice que es él. */}
                            {c.assignee?.id === viewer.userId
                              ? "Requiere tu atención"
                              : !c.assignee
                                ? "Requiere humano · sin asignar"
                                : "Atención humana"}
                          </span>
                        )}
                        {seesAll && (
                          <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border-strong bg-chip px-1.5 py-px text-[10.5px] leading-4 font-medium text-text-2">
                            <span className="truncate">
                              {c.assignee
                                ? c.assignee.id === viewer.userId
                                  ? "Tú"
                                  : c.assignee.name
                                : "Sin asignar"}
                            </span>
                          </span>
                        )}
                        {c.anuncio && (
                          <span
                            className="inline-flex min-w-0 items-center gap-1 rounded-full border border-info-soft bg-info-tint px-1.5 py-px text-[10.5px] leading-4 text-info-text"
                            title={titularDeOrigen(c.anuncio.headline, c.anuncio.sourceType)}
                          >
                            <Megaphone className="h-2.5 w-2.5 shrink-0" strokeWidth={1.8} />
                            <span className="truncate">
                              {etiquetaDeOrigen(c.anuncio.sourceType)}
                              {c.anuncio.headline ? ` · ${c.anuncio.headline}` : ""}
                            </span>
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
