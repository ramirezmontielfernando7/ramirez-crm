"use client";

import {
  memo,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { m } from "framer-motion";
import dynamic from "next/dynamic";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { Bot, CheckSquare, Megaphone, Send, Sparkles } from "lucide-react";
import type { ConversationDto, StageDto } from "@/lib/types";
import type { TagDto } from "@/lib/tags";
import type { MenuAnchor } from "./floating-menu";
import { etiquetaDeOrigen, titularDeOrigen } from "@/lib/anuncios";
import { campaignPendingLabel, campaignReplyLabel } from "@/lib/campaign-inbox";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { ChannelBadge } from "@/components/channel-badge";
import { contactLabel, looksLikePhone } from "@/lib/phone-search";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { formatTime, previewText } from "./helpers";
import { useViewer } from "@/components/viewer-context";
import { assignContacts, useAssignees } from "@/components/assignment/use-assignees";
import { NavRevealButton } from "@/components/nav-mode";
import { InboxModeSwitch } from "./inbox-mode-switch";
import { FilterMenu, type InboxFilter } from "./filter-menu";
import { rowAiBadge } from "@/lib/agent-pause";
import { useAgentsPaused } from "./use-agents-paused";
import { ALL_TAGS } from "@/lib/inbox-filters";
import {
  listQueryParams,
  matchesListQuery,
  type InboxCounts,
  type ListQuery,
  type ListStatus,
} from "@/lib/inbox-list";
import { AssigneeCapsule, StageCapsule, TagsCapsule, type PatchRow } from "./chat-capsules";
import { useConversationActions } from "./conversation-actions";
import { longPressClass, useLongPress } from "./use-long-press";
import { useInboxCatalogs } from "./use-inbox-catalogs";
import { SearchPill } from "./search-pill";
import { Collapse, SPRING } from "@/components/motion";

// La tarjeta de «número sin registrar» solo sale al buscar un teléfono que no
// existe: su código no se baja en el arranque de la Bandeja.
const UnregisteredNumberCard = dynamic(
  () => import("./unregistered-number").then((mod) => mod.UnregisteredNumberCard)
);

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

/**
 * Fluidez PR 2: la lista es VIRTUAL. Solo existen en el DOM las filas que se
 * ven (más un margen arriba y abajo); con 5,000 chats hay ~30 filas, no 5,000.
 * El alto de cada fila se mide al pintarla (las de campaña o anuncio llevan
 * una cápsula más); 84 px es el típico y solo sirve hasta medirla.
 */
const ROW_ESTIMATE = 84;
const ROW_OVERSCAN = 8;
/**
 * Fluidez PR 4: el alto que se supone para la caja de la lista ANTES de
 * medirla (en el HTML del servidor no hay caja que medir). Con esto el
 * servidor ya pinta las primeras ~18 filas; al medirla, se ajusta.
 */
const LIST_HEIGHT_ESTIMATE = 900;
/** Fluidez PR 3: a cuántas filas del final se pide la página siguiente. */
const LOAD_MORE_THRESHOLD = 15;
/** Respiro de la búsqueda antes de preguntarle al servidor. */
const SEARCH_DEBOUNCE_MS = 250;

const CONTROL_FILTRO =
  "box-border h-6 shrink-0 rounded-full border py-0 text-[11.5px] font-semibold leading-none transition-colors";

function EmptyState({ onSeeded }: { onSeeded: () => void }) {
  const [seeding, setSeeding] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function seed() {
    setSeeding(true);
    const res = await fetch("/api/seed/demo", { method: "POST" }).catch(
      () => null
    );
    setSeeding(false);
    if (res?.ok) onSeeded();
    else {
      // El servidor explica en español por qué no se puede (409).
      const body = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setFailed(
        body?.error?.message ??
          "No se pudo cargar la demostración. Inténtalo de nuevo."
      );
    }
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
      {failed ? (
        <p role="alert" className="max-w-xs text-xs text-text-3">
          {failed}
        </p>
      ) : (
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
  loadedKey,
  counts,
  hasMore,
  loadingMore,
  onLoadMore,
  onListQuery,
  channels,
  selectedId,
  onSelect,
  onSeeded,
  onPatchRow,
  onRemoved,
}: {
  /** Fluidez PR 3: lo cargado (páginas ya filtradas por el servidor). */
  conversations: ConversationDto[] | null;
  /** De qué filtros es lo cargado (`listQueryParams`); null = aún nada. */
  loadedKey: string | null;
  /** Los contadores del servidor (null = aún no llegan). */
  counts: InboxCounts | null;
  /** ¿Quedan páginas por pedir? */
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** Cambiaron los filtros: la lista se pide de nuevo con estos. */
  onListQuery: (q: ListQuery) => void;
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
  const agentsPaused = useAgentsPaused();
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

  const showCampaigns = filter === "campaigns";
  // Fluidez PR 3: los filtros viajan al servidor. La búsqueda, tras un
  // respiro (no una petición por tecla); mientras, lo cargado se filtra aquí.
  const [sentQuery, setSentQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSentQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);
  const listQuery: ListQuery = {
    view: showCampaigns ? "campaigns" : "main",
    status: showCampaigns ? "all" : (filter as ListStatus),
    q: sentQuery,
    stage,
    tag,
    owner: seesAll ? owner : "all",
    channel: inbox,
  };
  const listKey = listQueryParams(listQuery).toString();
  const listQueryNow = useRef(listQuery);
  listQueryNow.current = listQuery;
  useEffect(() => onListQuery(listQueryNow.current), [listKey, onListQuery]);

  const loading = conversationsProp === null;
  /** Lo cargado aún es de otros filtros (la página nueva viene en camino). */
  const pending = loadedKey !== listKey;
  const conversations = conversationsProp ?? [];
  // La MISMA regla del servidor sobre lo cargado, con la búsqueda tal como
  // se teclea: un cambio propio (archivar, leer, mover de etapa) se ve ya.
  const visibleQuery: ListQuery = { ...listQuery, q: query };
  const visible = conversations.filter((c) => matchesListQuery(c, visibleQuery, viewer.userId));
  // «Número no registrado»: parece teléfono y ninguna conversación lo tiene
  // (lo cuenta el servidor, con esta misma búsqueda).
  const sinRegistrar =
    looksLikePhone(query) && counts !== null && counts.q === query.trim() && counts.queryHits === 0;
  const inboxCount = (ch: Channel) => counts?.channels[ch] ?? 0;
  const humanos = counts?.humano ?? 0;
  const anuncios = counts?.anuncios ?? 0;
  const campaignCount = counts?.campaignPending ?? 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  // Si lo cargado quedó todo fuera del filtro (p. ej. se archivó lo último
  // que había) pero el servidor tiene más, se pide sin esperar al scroll.
  const needMore = !pending && visible.length === 0 && hasMore && !loadingMore;
  useEffect(() => {
    if (needMore) onLoadMore();
  }, [needMore, onLoadMore]);

  const filtros: { id: typeof filter; label: string; count: number }[] = [
    { id: "all", label: "Todas", count: counts?.all ?? 0 },
    { id: "unread", label: "No leídas", count: counts?.unread ?? 0 },
    // 034: siempre a la vista, junto a «Todas» y «No leídas».
    { id: "archived", label: "Archivados", count: counts?.archived ?? 0 },
  ];
  // Sin ninguna conversación de anuncio el filtro no aparece: a quien no
  // anuncia no se le pinta un botón que siempre dice 0. Si está elegido, se
  // queda, para poder salir de él aunque el contador baje a cero.
  // 020: los chats que esperan a una persona (la IA hizo handoff).
  if (humanos > 0 || filter === "humano") {
    filtros.push({ id: "humano", label: "Atención humana", count: humanos });
  }
  if (anuncios > 0 || filter === "anuncios") {
    filtros.push({ id: "anuncios", label: "Anuncios", count: anuncios });
  }
  // 041: los chats que abrió una campaña y nadie ha respondido. Sin ninguno,
  // no aparece (igual que «Anuncios»). Abierta, cuenta lo que muestra.
  if (campaignCount > 0 || showCampaigns) {
    filtros.push({
      id: "campaigns",
      label: "Campañas",
      count: showCampaigns ? (counts?.campaigns ?? 0) : campaignCount,
    });
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

  // Etapas presentes en la bandeja (las cuenta el servidor), más la elegida.
  const stages: string[] = [...(counts?.stages ?? [])];
  if (stage !== "all" && !stages.includes(stage)) stages.push(stage);

  // 034: etiquetas que llevan los chats de la bandeja (más la elegida, para
  // poder salir de ella aunque ya ningún chat la lleve).
  const tagsPresent = new Map<string, string>(counts?.tags ?? []);
  if (tag !== ALL_TAGS && !tagsPresent.has(tag)) {
    tagsPresent.set(tag, catalogs.tags.find((t) => t.id === tag)?.name ?? "Etiqueta");
  }
  const tagOptions = [...tagsPresent].sort((a, b) => a[1].localeCompare(b[1], "es"));

  // Personas en el selector: el equipo (si se puede leer) más quien aparezca
  // asignado en la bandeja.
  const owners = new Map<string, string>();
  for (const a of assignees) owners.set(a.userId, a.name);
  for (const [id, name] of counts?.owners ?? []) {
    if (!owners.has(id)) owners.set(id, name);
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
        <div ref={rowRef} className="relative flex items-center gap-1.5">
          <NavRevealButton />
          {/* 039: «Bandeja ▾» cambia al Chat de equipo (si la organización lo tiene). */}
          <InboxModeSwitch current="inbox" className={bajoBuscador} />
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
                      "flex items-center gap-0.5 rounded-full border py-[3px] pl-[5px] pr-1.5 text-[11.5px] font-medium transition-colors",
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

      {agentsPaused && (
        <p
          data-ai-paused-notice
          title="Los agentes de IA están en pausa: los chats nuevos pasan a una persona"
          className="flex shrink-0 items-center gap-1.5 border-b bg-warning-tint px-4 py-1 text-[11.5px] font-medium text-warning-text"
        >
          <Bot className="h-3 w-3" aria-hidden />
          IA en pausa
        </p>
      )}

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

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading || (visible.length === 0 && pending) ? (
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
        ) : counts?.total === 0 && campaignCount === 0 && !showCampaigns ? (
          <EmptyState onSeeded={onSeeded} />
        ) : visible.length === 0 && (hasMore || counts === null) ? (
          <p className="p-6 text-center text-xs text-text-3">Cargando…</p>
        ) : visible.length === 0 ? (
          <p className="p-6 text-center text-xs text-text-3">
            Sin resultados para este filtro.
          </p>
        ) : (
          <VirtualRows
            items={visible}
            scrollRef={scrollRef}
            selectedId={selectedId}
            onEndReached={hasMore && !loadingMore ? onLoadMore : undefined}
            renderRow={(c, v, measureRef) => (
              <ConversationRow
                key={v.key}
                index={v.index}
                start={v.start}
                measureRef={measureRef}
                agentsPaused={agentsPaused}
                c={c}
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
            )}
          />
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
 * Fluidez PR 2: la lista virtual, aparte de `ConversationList` a propósito.
 * Al bajar, el virtualizador vuelve a pintar SOLO este componente (qué filas
 * tocan y dónde van); los filtros, contadores y el encabezado de la lista no
 * se recalculan en cada cuadro de scroll.
 */
function VirtualRows({
  items: visible,
  scrollRef,
  selectedId,
  onEndReached,
  renderRow,
}: {
  items: ConversationDto[];
  /** Fluidez PR 3: se acerca el final de lo cargado (undefined = no pedir más). */
  onEndReached?: () => void;
  /** La caja con scroll (la columna de la lista). */
  scrollRef: RefObject<HTMLDivElement | null>;
  selectedId: string | null;
  renderRow: (
    c: ConversationDto,
    v: VirtualItem,
    measureRef: (el: HTMLElement | null) => void
  ) => ReactNode;
}) {
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: ROW_OVERSCAN,
    initialRect: { width: 0, height: LIST_HEIGHT_ESTIMATE },
    getItemKey: (i) => visible[i]?.id ?? i,
    // React 19: sin `flushSync` en cada evento de scroll (avisa en consola y
    // no hace falta; la fila nueva llega en el siguiente cuadro).
    useFlushSync: false,
  });
  // Fluidez PR 3: a LOAD_MORE_THRESHOLD filas del final, la página siguiente.
  const pintadas = virtualizer.getVirtualItems();
  const lastIndex = pintadas[pintadas.length - 1]?.index ?? -1;
  const nearEnd = lastIndex >= visible.length - LOAD_MORE_THRESHOLD;
  useEffect(() => {
    if (nearEnd) onEndReached?.();
  }, [nearEnd, onEndReached]);

  // El chat abierto queda a la vista aunque se haya elegido desde fuera de la
  // lista (`/inbox?contact=…`) o un filtro lo haya movido: si su fila no está
  // pintada o está fuera del recuadro, se baja (o sube) hasta ella. Solo
  // cuando cambia el chat abierto, no en cada refresco de la lista. Se revisa
  // unos cuadros más: las filas que se pintan al llegar se miden y pueden
  // empujar la elegida un poco fuera.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => {
    if (!selectedId) return;
    let cuadro = 0;
    const traer = (intentos: number) => {
      const i = visibleRef.current.findIndex((c) => c.id === selectedId);
      if (i < 0) return;
      const caja = scrollRef.current;
      const fila = caja?.querySelector(`[data-index="${i}"]`);
      if (caja && fila) {
        const a = fila.getBoundingClientRect();
        const b = caja.getBoundingClientRect();
        if (a.top >= b.top && a.bottom <= b.bottom) return;
      }
      virtualizer.scrollToIndex(i, { align: "auto" });
      if (intentos > 0) cuadro = requestAnimationFrame(() => traer(intentos - 1));
    };
    traer(10);
    return () => cancelAnimationFrame(cuadro);
  }, [selectedId, virtualizer, scrollRef]);

  // Teclado: ↑/↓ pasan al chat de arriba/abajo aunque su fila aún no exista
  // (la lista virtual solo pinta lo que se ve): primero se lleva la fila a la
  // vista y luego se le da el foco. Con la tecla sostenida, la siguiente
  // pulsación puede llegar antes de que la fila nueva exista: se cuenta desde
  // la fila PEDIDA, no desde la que aún tiene el foco.
  const focoPendiente = useRef<number | null>(null);
  function onListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const desde = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
    if (!desde || !(e.target as HTMLElement).matches("[data-row-main]")) return;
    const base = focoPendiente.current ?? Number(desde.dataset.index);
    const i = Math.min(Math.max(base + (e.key === "ArrowDown" ? 1 : -1), 0), visible.length - 1);
    e.preventDefault();
    focoPendiente.current = i;
    virtualizer.scrollToIndex(i, { align: "auto" });
    const enfocar = (intentos: number) => {
      if (focoPendiente.current !== i) return; // ya se pidió otra
      const btn = scrollRef.current?.querySelector<HTMLElement>(
        `[data-index="${i}"] [data-row-main]`
      );
      if (btn || intentos === 0) {
        focoPendiente.current = null;
        btn?.focus({ preventScroll: true });
      } else requestAnimationFrame(() => enfocar(intentos - 1));
    };
    enfocar(20);
  }

  return (
    <ul
      onKeyDown={onListKeyDown}
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((v) => {
        const c = visible[v.index];
        return c ? renderRow(c, v, virtualizer.measureElement) : null;
      })}
    </ul>
  );
}

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
  index,
  start,
  measureRef,
  c,
  active,
  selecting,
  picked,
  multiChannel,
  agentsPaused,
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
  /** Fluidez PR 2: posición en la lista virtual y dónde empieza (px). */
  index: number;
  start: number;
  /** Mide el alto real de la fila al pintarla. */
  measureRef: (el: HTMLElement | null) => void;
  c: ConversationDto;
  active: boolean;
  selecting: boolean;
  picked: boolean;
  multiChannel: boolean;
  /** Pausa general de los agentes (se avisa en el encabezado, no en la fila). */
  agentsPaused: boolean;
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
  const aiBadge = rowAiBadge({ ...c, orgPaused: agentsPaused });
  const aiOn = aiBadge === "on";
  // El texto de ayuda explica el estado; el nombre accesible sigue siendo corto.
  const aiHint = aiOn
    ? "Atendido por un agente de IA"
    : c.handoffAt
      ? "Agente de IA en pausa: esperando a una persona"
      : "Agente de IA en pausa en este chat";

  return (
    <li
      // Fluidez PR 1: sin animación de entrada (con miles de filas, montar
      // una animación por fila congelaba la Bandeja). PR 2: la lista es
      // virtual; cada fila se coloca en su `start` y se mide al pintarse.
      // Separador que arranca en el texto (no bajo el avatar): la
      // columna de avatares queda limpia y el ojo baja por ella.
      ref={measureRef}
      data-index={index}
      style={{ transform: `translateY(${start}px)` }}
      className="inbox-row absolute left-0 top-0 w-full after:absolute after:bottom-0 after:left-[58px] after:right-0 after:h-px after:bg-border"
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
          data-row-main
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
              </span>
              <span
                className={cn(
                  "shrink-0 text-[11px] leading-5 tabular-nums",
                  unread ? "font-semibold text-brand-ink" : "font-medium text-text-3"
                )}
              >
                <RowTime iso={c.lastMessageAt} />
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
        <div className="relative flex flex-col gap-1.5 pb-[var(--row-py)] pl-[58px] pr-4 pt-2">
          {aiBadge !== "none" && (
            // Debajo del círculo del avatar (cuyo punto verde de «ventana
            // abierta» está en su esquina inferior derecha, sin chocar),
            // centrado en su columna de 32 px y sin cambiar el alto de la
            // fila. Punto del ícono: verde = activa, naranja = en pausa.
            <span className="pointer-events-none absolute left-4 top-1.5 flex h-4 w-8 items-center justify-center">
              <span
                role="img"
                aria-label={aiOn ? "IA activa" : "IA en pausa"}
                title={aiHint}
                data-ai-badge={aiBadge}
                className={cn(
                  "pointer-events-auto relative inline-flex text-text-3",
                  !aiOn && "opacity-60"
                )}
              >
                <Bot className="h-3 w-3" strokeWidth={1.8} aria-hidden />
                <span
                  className={cn(
                    "absolute -right-[3px] -top-[2px] h-[6px] w-[6px] rounded-full border border-background",
                    aiOn ? "bg-success" : "bg-warning"
                  )}
                />
              </span>
            </span>
          )}
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
          {c.campaign && (
            <span
              data-campaign-chip={c.campaign.state}
              className={cn(
                CHIP,
                "self-start",
                c.campaign.state === "replied" ? "bg-brand-tint text-brand-text" : "bg-chip text-text-2"
              )}
            >
              <Send className="h-3 w-3 shrink-0" strokeWidth={2} />
              <span className="truncate">
                {c.campaign.state === "replied"
                  ? campaignReplyLabel(c.campaign.name)
                  : campaignPendingLabel(c.campaign.name)}
              </span>
            </span>
          )}
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
    </li>
  );
});

const sinSuscripcion = () => () => {};

/**
 * Fluidez PR 4 — La hora de la fila, con la zona horaria y el idioma del
 * NAVEGADOR. El HTML del servidor (otra zona, otro Intl) la deja vacía y se
 * pone en cuanto la página despierta en el navegador: si el servidor pusiera
 * la suya, el navegador la tendría que corregir fila por fila.
 */
function RowTime({ iso }: { iso: string | null }) {
  const enNavegador = useSyncExternalStore(
    sinSuscripcion,
    () => true,
    () => false
  );
  return <>{enNavegador ? formatTime(iso) : ""}</>;
}
