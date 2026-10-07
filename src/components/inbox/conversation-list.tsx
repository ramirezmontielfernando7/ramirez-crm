"use client";

import { memo, useEffect, useRef, useState } from "react";
import { m } from "motion/react";
import { Bot, CheckSquare, Megaphone, Sparkles } from "lucide-react";
import type { ConversationDto, StageDto } from "@/lib/types";
import type { TagDto } from "@/lib/tags";
import type { MenuAnchor } from "./floating-menu";
import { etiquetaDeOrigen, titularDeOrigen } from "@/lib/anuncios";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { ChannelBadge } from "@/components/channel-badge";
import { matchesQuery } from "@/lib/search";
import { contactLabel, looksLikePhone } from "@/lib/phone-search";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { formatTime, previewText } from "./helpers";
import { useViewer } from "@/components/viewer-context";
import { assignContacts, useAssignees } from "@/components/assignment/use-assignees";
import { NavRevealButton } from "@/components/nav-mode";
import { FilterMenu, type InboxFilter } from "./filter-menu";
import { ALL_TAGS, inArchiveView, isArchived, matchesTag } from "@/lib/inbox-filters";
import { AssigneeCapsule, StageCapsule, TagsCapsule, type PatchRow } from "./chat-capsules";
import { useConversationActions } from "./conversation-actions";
import { longPressClass, useLongPress } from "./use-long-press";
import { useInboxCatalogs } from "./use-inbox-catalogs";
import { SearchPill } from "./search-pill";
import { UnregisteredNumberCard } from "./unregistered-number";
import { Collapse, ENTER, SPRING } from "@/components/motion";

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
/**
 * Las cápsulas de cada renglón (etapa, asignado, atención humana, anuncio):
 * UNA medida — 20 px de alto, texto de 10.5 px sin interlineado propio — y
 * relleno suave en vez de borde, así se leen como etiquetas y no como
 * botones, y todas comparten el eje aunque lleven punto o ícono.
 */
const CHIP =
  "inline-flex h-5 min-w-0 items-center gap-1 rounded-full px-2 text-[10.5px] font-medium leading-none";

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
      <p className="text-[21px] font-semibold leading-tight text-foreground">
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

/** Memoizado por lo mismo que `MessageThread`: el panel de Detalles no la toca. */
export const ConversationList = memo(function ConversationList({
  conversations: conversationsProp,
  channels,
  selectedId,
  onSelect,
  onSeeded,
  onPatchRow,
  onRemoved,
}: {
  conversations: ConversationDto[] | null;
  /** Canales encendidos en esta instancia (ADR-001). */
  channels: readonly Channel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeeded: () => void;
  /** 034: pinta un cambio de la fila al instante (cápsulas). */
  onPatchRow: PatchRow;
  /** 034: se archivó, recuperó o eliminó un chat. */
  onRemoved: (id: string, kind: "archive" | "restore" | "delete") => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [stage, setStage] = useState<string>("all");
  const [inbox, setInbox] = useState<Channel | "all">("all");
  const rowRef = useRef<HTMLDivElement>(null);
  // Con el buscador abierto, lo que cubre (título, filtros) se desvanece
  // mientras el campo se estira: un cruce, no dos capas encimadas.
  const [searchOpen, setSearchOpen] = useState(false);
  const bajoBuscador = cn(
    "transition-opacity duration-200",
    searchOpen && "pointer-events-none opacity-0"
  );
  // 020: quién atiende. "all" | "mine" | "unassigned" | <userId>. Solo lo
  // ve quien ve a todo el equipo; al asesor el servidor ya le manda lo suyo.
  const viewer = useViewer();
  const seesAll = viewer.can("scope.all");
  const canAssign = viewer.can("assignment.manage");
  const assignees = useAssignees();
  const [owner, setOwner] = useState<string>("all");
  // 034: filtro por etiqueta ("all" = toda etiqueta).
  const [tag, setTag] = useState<string>(ALL_TAGS);
  const catalogs = useInboxCatalogs();
  const canCreateTags = viewer.can("tags.manage");
  // Un fallo de una cápsula se dice en una línea flotante: sin esto, el
  // cambio se revertiría en silencio.
  const [notice, setNotice] = useState<string | null>(null);
  const actions = useConversationActions(onRemoved);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  // Selección para asignar en lote.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkTo, setBulkTo] = useState<string>("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const loading = conversationsProp === null;
  const conversations = conversationsProp ?? [];
  // Solo NOMBRE y TELÉFONO, como cualquier filtro de contactos. Antes también
  // miraba el preview, y como el agente nombra al dueño en sus propios
  // mensajes, buscar ese nombre devolvía media bandeja. Encima era una
  // búsqueda de mensajes a medias: solo el último de cada hilo, no el historial.
  const searchedAll = conversations.filter(
    (c) =>
      matchesQuery(query, {
        text: [c.contact.name],
        phone: c.contact.phone,
      }) &&
      (stage === "all" || c.stageName === stage) &&
      matchesTag(c, tag) &&
      (owner === "all" ||
        (owner === "mine" && c.assignee?.id === viewer.userId) ||
        (owner === "unassigned" && !c.assignee) ||
        c.assignee?.id === owner)
  );
  // 034: las archivadas no cuentan en «Todas», «No leídas»… y se ven aparte.
  const showArchived = filter === "archived";
  const archivadas = searchedAll.filter(isArchived);
  const searched = searchedAll.filter((c) => inArchiveView(c, false));
  // «Número no registrado»: parece teléfono y ninguna conversación lo tiene.
  const sinRegistrar =
    looksLikePhone(query) &&
    !conversations.some((c) =>
      matchesQuery(query, { text: [c.contact.name], phone: c.contact.phone })
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
  const archivadasEnBandeja =
    inbox === "all" ? archivadas : archivadas.filter((c) => c.channel === inbox);
  const visible = showArchived
    ? archivadasEnBandeja
    : filter === "humano"
      ? humanos
      : visibleBase;
  const filtros: { id: typeof filter; label: string; count: number }[] = [
    { id: "all", label: "Todas", count: inInbox.length },
    { id: "unread", label: "No leídas", count: unreadCount },
    // 034: siempre a la vista, junto a «Todas» y «No leídas».
    { id: "archived", label: "Archivados", count: archivadasEnBandeja.length },
  ];
  if (humanos.length > 0 || filter === "humano") {
    filtros.push({ id: "humano", label: "Atención humana", count: humanos.length });
  }
  if (deAnuncios.length > 0 || filter === "anuncios") {
    filtros.push({ id: "anuncios", label: "Anuncios", count: deAnuncios.length });
  }
  // Lo que la cápsula de filtros diría, para el buscador abierto que la tapa.
  const extraFiltros =
    (stage !== "all" ? 1 : 0) + (seesAll && owner !== "all" ? 1 : 0) + (tag !== ALL_TAGS ? 1 : 0);
  const filtroPuesto =
    filter === "all" && extraFiltros === 0
      ? null
      : `${filtros.find((f) => f.id === filter)?.label ?? "Todas"}${extraFiltros > 0 ? ` +${extraFiltros}` : ""}`;
  // Con un solo canal encendido no hay bandejas que distinguir: ni marca en
  // los renglones ni filtro. La pantalla queda exactamente como antes de 014.
  const multiChannel = channels.length > 1;

  // Etapas presentes en la bandeja, en el orden en que llegan del pipeline.
  const stages: string[] = [];
  for (const c of conversations) {
    if (c.stageName && !stages.includes(c.stageName)) stages.push(c.stageName);
  }

  // 034: etiquetas que llevan los chats de la bandeja (más la elegida, para
  // poder salir de ella aunque ya ningún chat la lleve).
  const tagsPresent = new Map<string, string>();
  for (const c of conversations) for (const t of c.tags) tagsPresent.set(t.id, t.name);
  if (tag !== ALL_TAGS && !tagsPresent.has(tag)) {
    tagsPresent.set(tag, catalogs.tags.find((t) => t.id === tag)?.name ?? "Etiqueta");
  }
  const tagOptions = [...tagsPresent].sort((a, b) => a[1].localeCompare(b[1], "es"));

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

  return (
    <div className="flex h-full flex-col">
      {/* 56 px, el mismo alto que el encabezado del chat y el de Detalles: las
          tres columnas comparten la línea de abajo. */}
      <header className="flex h-14 shrink-0 flex-col justify-center border-b px-4">
        {/* `relative`: el panel de filtros y el buscador abierto se anclan a
            esta fila, no a su botón, para no salirse nunca de la columna. */}
        <div ref={rowRef} className="relative flex items-center gap-2">
          <NavRevealButton />
          <h2 className={cn("text-[17px] font-bold tracking-tight", bajoBuscador)}>Bandeja</h2>
          {/* Una cápsula con el filtro en uso; al tocarla despliega el resto.
              La selección múltiple viaja pegada a ella. */}
          <div className="flex items-center gap-1">
            <div className={cn("flex items-center gap-1", bajoBuscador)}>
              <FilterMenu
                filtros={filtros}
                filter={filter}
                onFilter={setFilter}
                stages={stages}
                stage={stage}
                onStage={setStage}
                tags={tagOptions}
                tag={tag}
                onTag={setTag}
                owners={seesAll ? [...owners] : null}
                owner={owner}
                onOwner={setOwner}
              />
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
            <SearchPill
              query={query}
              onQuery={setQuery}
              rowRef={rowRef}
              onOpenChange={setSearchOpen}
              hint={filtroPuesto}
            />
          </div>
          {multiChannel && (
            <div className={cn("ml-auto flex items-center gap-1", bajoBuscador)}>
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
      </header>

      <Collapse open={selecting}>
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
      </Collapse>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-center text-xs text-text-3">Cargando…</p>
        ) : visible.length === 0 && sinRegistrar ? (
          // Un teléfono que no existe en NINGUNA conversación (sin importar los
          // filtros: si solo lo esconde un filtro, no está «sin registrar»).
          // También en una bandeja vacía: ahí es justo cuando más se necesita.
          <UnregisteredNumberCard
            query={query}
            onOpenChat={(id) => {
              onSeeded();
              onSelect(id);
            }}
          />
        ) : conversations.length === 0 ? (
          <EmptyState onSeeded={onSeeded} />
        ) : visible.length === 0 ? (
          <p className="p-6 text-center text-xs text-text-3">
            Sin resultados para este filtro.
          </p>
        ) : (
          // La llave cambia con el filtro (no con cada tecla de la búsqueda):
          // al filtrar, la lista vuelve a "caer" en su lugar escalonada.
          <ul key={`${filter}|${stage}|${tag}|${owner}|${inbox}`}>
            {visible.map((c, index) => (
              <ConversationRow
                key={c.id}
                c={c}
                index={index}
                active={selectedId === c.id}
                selecting={selecting}
                picked={picked.has(c.id)}
                multiChannel={multiChannel}
                viewerId={viewer.userId}
                stages={catalogs.stages}
                tagCatalog={catalogs.tags}
                canCreateTags={canCreateTags}
                onCatalogAdd={catalogs.addTag}
                members={assignees}
                canAssign={canAssign}
                onSelect={onSelect}
                onTogglePick={togglePick}
                onPatchRow={onPatchRow}
                onRefetch={onSeeded}
                onError={setNotice}
                onOpenMenu={actions.openMenu}
              />
            ))}
          </ul>
        )}
      </div>
      {actions.element}
      {notice && (
        <p
          role="status"
          className="fixed bottom-4 left-1/2 z-[70] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-[12.5px] shadow-pop"
        >
          {notice}
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="ml-2 font-semibold text-brand-text hover:underline"
          >
            Cerrar
          </button>
        </p>
      )}
    </div>
  );
});

/**
 * Una fila de la lista. Es un componente (y no un `map` en línea) porque
 * lleva su propia pulsación larga. Estructura, de afuera hacia adentro:
 *
 *   li > div.fila (fondo, clic derecho, pulsación larga)
 *          ├─ <button> avatar + nombre + preview     ← abre el chat
 *          └─ div  cápsulas (Etapa · Etiquetas · Asignado)
 *
 * Las cápsulas son botones PROPIOS y quedan fuera del botón principal: un
 * botón dentro de otro no es HTML válido y el clic de una no debe abrir el chat.
 */
const ConversationRow = memo(function ConversationRow({
  c,
  index,
  active,
  selecting,
  picked,
  multiChannel,
  viewerId,
  stages,
  tagCatalog,
  canCreateTags,
  onCatalogAdd,
  members,
  canAssign,
  onSelect,
  onTogglePick,
  onPatchRow,
  onRefetch,
  onError,
  onOpenMenu,
}: {
  c: ConversationDto;
  index: number;
  active: boolean;
  selecting: boolean;
  picked: boolean;
  multiChannel: boolean;
  viewerId: string;
  stages: StageDto[];
  tagCatalog: TagDto[];
  canCreateTags: boolean;
  onCatalogAdd: (tag: TagDto) => void;
  members: { userId: string; name: string }[];
  canAssign: boolean;
  onSelect: (id: string) => void;
  onTogglePick: (id: string) => void;
  onPatchRow: PatchRow;
  onRefetch: () => void;
  onError: (message: string) => void;
  onOpenMenu: (target: Pick<ConversationDto, "id" | "archivedAt">, anchor: MenuAnchor) => void;
}) {
  const unread = c.unreadCount > 0;
  // Clic derecho (escritorio) y pulsación larga (touch) abren el MISMO menú.
  const press = useLongPress((x, y) => onOpenMenu(c, { kind: "point", x, y }));
  // 034: IA activa = punto verde; en pausa o esperando a una persona = naranja.
  // El texto completo («Requiere humano · sin asignar»…) vive solo en Detalles.
  const aiOn = c.aiEnabled && !c.handoffAt;

  return (
    <m.li
      // Entra con opacidad + 4 px; el escalón solo en las primeras
      // filas (las que se ven), así una lista larga no "gotea".
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...ENTER, delay: Math.min(index, 10) * 0.018 }}
      // Separador que arranca en el texto (no bajo el avatar): la
      // columna de avatares queda limpia y el ojo baja por ella.
      className="relative after:absolute after:bottom-0 after:left-[58px] after:right-0 after:h-px after:bg-border"
    >
      {active && (
        // La marca del chat abierto crece desde el centro.
        <m.span
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={SPRING}
          className="absolute inset-y-0 left-0 w-[3px] bg-brand"
        />
      )}
      <div
        {...press}
        data-conversation-row={c.id}
        className={cn(
          "transition-colors duration-150",
          longPressClass,
          active ? "bg-[var(--bg-active)]" : "hover:bg-row-hover"
        )}
      >
        <button
          onClick={() => (selecting ? onTogglePick(c.id) : onSelect(c.id))}
          aria-pressed={selecting ? picked : undefined}
          className={cn(
            "flex w-full items-start gap-2.5 px-4 pb-0 pt-[var(--row-py)] text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          )}
        >
          {selecting && (
            <input
              type="checkbox"
              readOnly
              tabIndex={-1}
              checked={picked}
              aria-label={`Seleccionar a ${contactLabel(c.contact)}`}
              className="mt-2 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
          )}
          {/* mt-[3px]: el avatar (32 px) queda centrado con el
              nombre y la vista previa (38 px juntos). */}
          <span className="relative mt-[3px] shrink-0">
            <ContactAvatar name={contactLabel(c.contact)} seed={c.contact.id} size="list" />
            {c.windowOpen && (
              <span className="absolute -bottom-px -right-px h-[9px] w-[9px] rounded-full border-2 border-background bg-success" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            {/* Nombre y hora en la MISMA línea base; la hora en la
                letra de la interfaz con cifras tabulares (antes
                monoespaciada: se veía más grande y fuera de eje). */}
            <span className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 self-center">
                {multiChannel && <ChannelBadge channel={c.channel} />}
                <span
                  className={cn(
                    "truncate text-[13.5px] leading-5 tracking-[-0.01em] text-foreground",
                    unread ? "font-bold" : "font-semibold"
                  )}
                >
                  {contactLabel(c.contact)}
                </span>
                {c.aiAvailable && (
                  <span
                    role="img"
                    aria-label={aiOn ? "IA activa" : "IA en pausa"}
                    title={aiOn ? "IA activa" : "IA en pausa"}
                    className="relative inline-flex shrink-0 text-text-3"
                  >
                    <Bot className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                    <span
                      className={cn(
                        "absolute -right-[3px] -top-[2px] h-[7px] w-[7px] rounded-full border border-background",
                        aiOn ? "bg-success" : "bg-warning"
                      )}
                    />
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "shrink-0 text-[11px] leading-5 tabular-nums",
                  unread ? "font-semibold text-brand-ink" : "font-medium text-text-3"
                )}
              >
                {formatTime(c.lastMessageAt)}
              </span>
            </span>
            <span className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "truncate text-[12.5px] leading-[18px]",
                  unread ? "font-medium text-foreground" : "text-text-2"
                )}
              >
                {previewText(c.preview)}
              </span>
              {unread && (
                <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-semibold tabular-nums leading-none text-brand-fg">
                  {c.unreadCount}
                </span>
              )}
            </span>
          </span>
        </button>
        {/* Alineadas con el texto (avatar de 32 px + espacios = 58 px). UNA sola
            línea: con poco ancho las cápsulas truncan su texto en vez de
            envolver (los «·» no pueden quedar colgando al final de una línea). */}
        <div className="flex flex-col gap-1.5 pb-[var(--row-py)] pl-[58px] pr-4 pt-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <StageCapsule conversation={c} stages={stages} onPatch={onPatchRow} onRefetch={onRefetch} onError={onError} />
            <span aria-hidden className="shrink-0 text-[10.5px] text-text-3">·</span>
            <TagsCapsule
              conversation={c}
              catalog={tagCatalog}
              canCreate={canCreateTags}
              onCatalogAdd={onCatalogAdd}
              onPatch={onPatchRow}
              onRefetch={onRefetch}
              onError={onError}
            />
            <span aria-hidden className="shrink-0 text-[10.5px] text-text-3">·</span>
            <AssigneeCapsule
              conversation={c}
              members={members}
              canAssign={canAssign}
              viewerId={viewerId}
              onPatch={onPatchRow}
              onRefetch={onRefetch}
              onError={onError}
            />
          </div>
          {c.anuncio && (
            <span
              className={cn(CHIP, "self-start bg-info-tint text-info-text")}
              title={titularDeOrigen(c.anuncio.headline, c.anuncio.sourceType)}
            >
              <Megaphone className="h-3 w-3 shrink-0" strokeWidth={2} />
              <span className="truncate">
                {etiquetaDeOrigen(c.anuncio.sourceType)}
                {c.anuncio.headline ? ` · ${c.anuncio.headline}` : ""}
              </span>
            </span>
          )}
        </div>
      </div>
    </m.li>
  );
});
