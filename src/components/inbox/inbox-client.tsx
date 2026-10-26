"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, MoreHorizontal, PanelRight } from "lucide-react";
import { m } from "framer-motion";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { ChatModeDot } from "./chat-mode-dot";
import { freeTextOutsideWindow, type InboxDirectContext } from "@/lib/direct-connection";
import type { ConversationDto, MessageDto } from "@/lib/types";
import { type Channel } from "@/lib/channels";
import { ChannelBadge } from "@/components/channel-badge";
import { useEvents } from "@/components/use-events";
import { ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { Composer } from "./composer";
import { contactLabel } from "@/lib/phone-search";
import { useConversationActions } from "./conversation-actions";
import { RefreshBatch, subsetQuery, type RefreshPlan } from "@/lib/inbox-refresh";
import {
  appendPage,
  listQueryParams,
  MAX_PAGE_SIZE,
  mergeSubsetPaged,
  PAGE_SIZE,
  type InboxCounts,
  type ListQuery,
} from "@/lib/inbox-list";
import type { PatchRow } from "./chat-capsules";

// Panel de Detalles (558 líneas + notas, ficha, línea de tiempo…): se baja en
// segundo plano, no en el arranque de la Bandeja. Va dentro de una tarjeta que
// ya tiene su tamaño, así que al llegar solo se llena.
const ContactPanel = dynamic(
  () => import("./contact-panel").then((mod) => mod.ContactPanel),
  { loading: () => <div className="h-full" aria-hidden /> }
);

/**
 * Texto que ya salió del compositor pero cuyo POST todavía viaja. Existe solo
 * en el cliente: se pinta como burbuja "enviando" para que escribir el
 * siguiente renglón no espere a Meta (~1,5 s de ida y vuelta).
 */
type PendingOut = {
  id: string;
  conversationId: string;
  text: string;
  createdAt: string;
};

/**
 * `xl` es el umbral donde caben las tres columnas (lista + hilo + detalles).
 * Debajo, el panel de detalles flota sobre el hilo. Debe coincidir con el
 * breakpoint `xl:` que usan las clases de la sección de detalles.
 */
const PANEL_MEDIA_QUERY = "(min-width: 1280px)";
/** Respiro para juntar avisos en vivo seguidos; el mismo del globo del menú. */
const REFETCH_DEBOUNCE_MS = 250;
const isWideEnoughForPanel = () =>
  typeof window !== "undefined" && window.matchMedia(PANEL_MEDIA_QUERY).matches;

/**
 * Fluidez PR 4 — La primera página y sus contadores, ya consultados por el
 * servidor al armar /inbox (con la organización y el rol de la sesión). Con
 * ella la lista se pinta desde el HTML, sin «Cargando…».
 */
export type InboxInitial = {
  /** Con qué filtros se consultó (la Bandeja recién abierta: la principal, sin filtros). */
  query: ListQuery;
  conversations: ConversationDto[];
  nextCursor: string | null;
  counts: InboxCounts;
};

export function InboxClient({
  channels,
  initial = null,
  direct = null,
}: {
  channels: readonly Channel[];
  /** Conexión directa (PR 5): null = el complemento está apagado (cero rastro). */
  direct?: InboxDirectContext | null;
  /** null = el servidor no la trajo: se pide desde el navegador, como antes. */
  initial?: InboxInitial | null;
}) {
  const multiChannel = channels.length > 1;
  const [conversations, setConversations] = useState<ConversationDto[] | null>(
    initial?.conversations ?? null
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [pending, setPending] = useState<PendingOut[]>([]);
  // Arranca cerrado: en pantallas angostas el panel de detalles es un cajón
  // ENCIMA del hilo, así que abrirlo por defecto taparía la conversación. El
  // efecto de abajo lo abre solo si de veras hay tres columnas de ancho.
  const [panelOpen, setPanelOpen] = useState(false);
  // Se incrementa con cada evento SSE que puede cambiar la etapa/lead o el
  // estado del agente: el panel de detalles lo observa y refetch en vivo.
  const [detailRev, setDetailRev] = useState(0);

  useEffect(() => {
    if (!isWideEnoughForPanel()) return;
    setPanelOpen(localStorage.getItem("vocero.panelOpen") !== "false");
  }, []);
  const togglePanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    // La preferencia es de escritorio: abrir el cajón en el teléfono no debe
    // reescribir cómo queda la Bandeja en la computadora.
    if (isWideEnoughForPanel()) {
      localStorage.setItem("vocero.panelOpen", String(open));
    }
  }, []);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const tmpSeq = useRef(0);
  // Los envíos salen en fila: el compositor ya no espera, pero WhatsApp debe
  // recibir "hola" antes que el renglón siguiente. Sin esta cadena, dos POST
  // simultáneos pueden llegar a Meta en desorden.
  const sendQueue = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Fluidez PR 3 — La lista llega POR PÁGINAS, ya filtrada por el servidor
   * con lo que la persona eligió en `ConversationList` (qué mostrar, búsqueda,
   * etapa, etiqueta, quién atiende, bandeja). Al bajar se pide la siguiente
   * con el cursor. Los contadores vienen aparte (`/counts`), con los mismos
   * filtros. «Campañas» es otra vista de la misma lista.
   */
  const [listQuery, setListQuery] = useState<ListQuery | null>(initial?.query ?? null);
  const listQueryRef = useRef<ListQuery | null>(null);
  listQueryRef.current = listQuery;
  /** De qué filtros es lo cargado (la lista muestra «Cargando…» mientras no coincide). */
  const [loadedKey, setLoadedKey] = useState<string | null>(
    initial ? listQueryParams(initial.query).toString() : null
  );
  const [counts, setCounts] = useState<InboxCounts | null>(initial?.counts ?? null);
  const nextCursor = useRef<string | null>(initial?.nextCursor ?? null);
  const [hasMore, setHasMore] = useState(initial ? initial.nextCursor !== null : false);
  const hasMoreRef = useRef(false);
  hasMoreRef.current = hasMore;
  const [loadingMore, setLoadingMore] = useState(false);
  const conversationsRef = useRef<ConversationDto[] | null>(null);
  conversationsRef.current = conversations;
  // Cada carga desde cero sube el número: una respuesta de antes (otros
  // filtros, o una página que viajaba) no pisa a la nueva.
  const listSeq = useRef(0);
  const countsSeq = useRef(0);

  /**
   * El chat abierto, aunque los filtros lo dejen fuera de lo cargado (antes la
   * lista entera siempre lo tenía): el hilo no se cierra al cambiar de filtro.
   */
  const [openConv, setOpenConv] = useState<ConversationDto | null>(null);
  const openConvRef = useRef<ConversationDto | null>(null);
  openConvRef.current = openConv;
  const loadingMoreRef = useRef(false);
  /** ¿Ya llegó la primera página? (sin ella, un refresco parcial no tiene sobre qué aplicar). */
  const loaded = useRef(initial !== null);

  const refetchCounts = useCallback(async () => {
    const q = listQueryRef.current;
    if (!q) return;
    const seq = ++countsSeq.current;
    const params = listQueryParams({ ...q, view: "main", status: "all" });
    const res = await fetch(`/api/conversations/counts?${params}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as InboxCounts;
    if (seq === countsSeq.current) setCounts(data);
  }, []);
  const countsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Tras un cambio propio o un aviso: los contadores, con el mismo respiro. */
  const scheduleCounts = useCallback(() => {
    if (countsTimer.current) clearTimeout(countsTimer.current);
    countsTimer.current = setTimeout(() => {
      countsTimer.current = null;
      void refetchCounts();
    }, REFETCH_DEBOUNCE_MS);
  }, [refetchCounts]);

  /**
   * La lista desde la primera página. `keep`: pide tanto como ya había
   * cargado (reconexión, datos de demostración), para no perder lo que la
   * persona ya bajó.
   */
  const reloadList = useCallback(async (keep: boolean) => {
    const q = listQueryRef.current;
    if (!q) return;
    const seq = ++listSeq.current;
    const already = conversationsRef.current?.length ?? 0;
    const limit = keep ? Math.min(Math.max(PAGE_SIZE, already), MAX_PAGE_SIZE) : PAGE_SIZE;
    const params = listQueryParams(q);
    params.set("limit", String(limit));
    const res = await fetch(`/api/conversations?${params}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { conversations: ConversationDto[]; nextCursor: string | null };
    if (seq !== listSeq.current) return;
    nextCursor.current = data.nextCursor;
    setHasMore(data.nextCursor !== null);
    setConversations(data.conversations);
    setLoadedKey(listQueryParams(q).toString());
    loaded.current = true;
  }, []);

  const loadMore = useCallback(async () => {
    const q = listQueryRef.current;
    const cursor = nextCursor.current;
    if (!q || !cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = listSeq.current;
    try {
      const params = listQueryParams(q);
      params.set("limit", String(PAGE_SIZE));
      params.set("cursor", cursor);
      const res = await fetch(`/api/conversations?${params}`).catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as { conversations: ConversationDto[]; nextCursor: string | null };
      if (seq !== listSeq.current) return;
      nextCursor.current = data.nextCursor;
      setHasMore(data.nextCursor !== null);
      setConversations((prev) => (prev ? appendPage(prev, data.conversations) : data.conversations));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  /** El chat abierto, pedido aparte (no está en lo cargado). null = ya no lo ve. */
  const fetchOpen = useCallback(async (id: string) => {
    for (const view of ["main", "campaigns"] as const) {
      const q = new URLSearchParams({ ids: id });
      if (view === "campaigns") q.set("view", "campaigns");
      const res = await fetch(`/api/conversations?${q}`).catch(() => null);
      if (!res?.ok) return undefined; // sin respuesta: se queda como estaba
      const data = (await res.json()) as { conversations: ConversationDto[] };
      const c = data.conversations[0];
      if (c) return c;
    }
    return null;
  }, []);

  /**
   * Paso 2 — La lista se refresca POR PARTES. Cada aviso apunta qué chat
   * cambió en un lote; tras un respiro corto (los de una ráfaga se juntan) se
   * piden SOLO esos con la misma consulta y permisos que la lista, y lo que no
   * vuelve sale de la vista. La lista completa (lo ya cargado), solo al
   * cargar, al reconectar o cuando un aviso no dice qué cambió.
   *
   * Las peticiones van EN FILA, una a la vez: una respuesta vieja nunca pisa
   * a una más nueva (antes lo cuidaba un contador de secuencia).
   */
  const batch = useRef(new RefreshBatch());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshing = useRef(false);
  const runPlan = useCallback(
    async (plan: RefreshPlan) => {
      if (plan.kind === "full") {
        await Promise.all([reloadList(true), refetchCounts()]);
        const open = selectedIdRef.current;
        if (open && !conversationsRef.current?.some((c) => c.id === open)) {
          const c = await fetchOpen(open);
          if (c !== undefined && selectedIdRef.current === open) setOpenConv(c);
        }
        return;
      }
      // Sin la lista inicial no hay sobre qué aplicar: la completa.
      if (!loaded.current || !listQueryRef.current) {
        batch.current.markFull();
        return;
      }
      const q = subsetQuery(plan);
      const view = listQueryRef.current.view;
      const seq = listSeq.current;
      const res = await fetch(`/api/conversations?${view === "campaigns" ? "view=campaigns&" : ""}${q}`).catch(() => null);
      if (!res?.ok) {
        // Sin la fila no hay cómo saber qué cambió: la lista completa.
        batch.current.markFull();
        return;
      }
      const data = (await res.json()) as { conversations: ConversationDto[] };
      if (seq === listSeq.current) {
        setConversations((prev) => prev && mergeSubsetPaged(prev, plan, data.conversations, hasMoreRef.current));
      }
      scheduleCounts();
      // El chat abierto: su fila nueva, aunque los filtros lo dejen fuera.
      const open = selectedIdRef.current;
      if (!open) return;
      const mine = data.conversations.find((c) => c.id === open);
      if (mine) setOpenConv(mine);
      else if (plan.ids.includes(open) || (openConvRef.current && plan.contactIds.includes(openConvRef.current.contact.id))) {
        const c = await fetchOpen(open);
        if (c !== undefined && selectedIdRef.current === open) setOpenConv(c);
      }
    },
    [reloadList, refetchCounts, scheduleCounts, fetchOpen]
  );
  const drain = useCallback(async () => {
    if (refreshing.current) return; // al terminar la que viaja, sigue con el lote
    refreshing.current = true;
    try {
      for (let plan = batch.current.take(); plan; plan = batch.current.take()) {
        try {
          await runPlan(plan);
        } catch {
          // Respuesta cortada a medias: lo parcial se repone con la lista
          // completa (una vez; si esa también falla, espera al siguiente aviso).
          if (plan.kind === "subset") batch.current.markFull();
        }
      }
    } finally {
      refreshing.current = false;
    }
  }, [runPlan]);
  /** Junta lo de la ráfaga y pide tras el respiro (`now`: sin esperar). */
  const scheduleRefresh = useCallback(
    (add: (b: RefreshBatch) => void, now = false) => {
      add(batch.current);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
      if (now) {
        void drain();
        return;
      }
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        void drain();
      }, REFETCH_DEBOUNCE_MS);
    },
    [drain]
  );
  /** La lista completa, ya (datos de demostración, asignación en lote). */
  const refetchConversations = useCallback(() => scheduleRefresh((b) => b.markFull(), true), [scheduleRefresh]);
  /** Solo la fila de este chat, ya (tras una acción propia sobre él). */
  const refreshConversation = useCallback(
    (id: string) => scheduleRefresh((b) => b.addConversation(id), true),
    [scheduleRefresh]
  );
  /**
   * PR 4: lo que pasó entre que el servidor consultó la primera página y que
   * esta pantalla quedó escuchando los avisos en vivo no trae aviso. Un
   * refresco completo, por detrás y sin «Cargando…» (lo de siempre se queda
   * pintado mientras llega), lo pone al día.
   */
  const fromServer = useRef(initial !== null);
  useEffect(() => {
    if (!fromServer.current) return;
    fromServer.current = false;
    scheduleRefresh((b) => b.markFull());
  }, [scheduleRefresh]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (countsTimer.current) clearTimeout(countsTimer.current);
    },
    []
  );
  /**
   * Cambiaron los filtros: la primera página de los nuevos y sus contadores.
   * Lo cargado se queda mientras tanto (la lista lo filtra igual en el
   * navegador), así no parpadea.
   */
  const onListQuery = useCallback(
    (q: ListQuery) => {
      const prev = listQueryRef.current;
      listQueryRef.current = q;
      setListQuery(q);
      // PR 4: al montar, la lista avisa sus filtros; si son los de la página
      // que mandó el servidor, ya está cargada: no se pide otra vez.
      if (prev && listQueryParams(prev).toString() === listQueryParams(q).toString()) return;
      nextCursor.current = null;
      setHasMore(false);
      void reloadList(false);
      // Los contadores no dependen de «qué mostrar»: solo si cambió lo demás.
      if (!prev || listQueryParams({ ...prev, view: "main", status: "all" }).toString() !== listQueryParams({ ...q, view: "main", status: "all" }).toString()) {
        void refetchCounts();
      }
    },
    [reloadList, refetchCounts]
  );

  const refetchMessages = useCallback(async (conversationId: string) => {
    const res = await fetch(
      `/api/conversations/${conversationId}/messages`
    ).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { messages: MessageDto[] };
    if (selectedIdRef.current === conversationId) setMessages(data.messages);
  }, []);

  // Estable para que `ConversationList` (memoizada) no se repinte de más.
  const onSeeded = useCallback(() => void refetchConversations(), [refetchConversations]);
  // 034: una cápsula cambió un dato de la fila: se pinta ya, sin esperar al
  // servidor (si falla, la fila se repone y se vuelve a pedir la lista).
  const patchRow = useCallback<PatchRow>(
    (id, patch) => {
      setConversations((prev) => prev && prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      setOpenConv((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
      setDetailRev((v) => v + 1);
      // Una etapa o etiqueta nueva mueve los contadores.
      scheduleCounts();
    },
    [scheduleCounts]
  );
  // 034: archivar, recuperar o eliminar un chat. Si era el abierto, se suelta
  // (en móvil vuelve a la lista); un eliminado sale de la lista al instante.
  const onRemoved = useCallback(
    (id: string, kind: "archive" | "restore" | "delete") => {
      if (selectedIdRef.current === id) setSelectedId(null);
      // Se refleja YA, sin esperar a la lista del servidor.
      setConversations(
        (prev) =>
          prev &&
          (kind === "delete"
            ? prev.filter((c) => c.id !== id)
            : prev.map((c) =>
                c.id === id
                  ? { ...c, archivedAt: kind === "archive" ? new Date().toISOString() : null }
                  : c
              ))
      );
      setOpenConv((prev) =>
        prev?.id !== id
          ? prev
          : kind === "delete"
            ? null
            : { ...prev, archivedAt: kind === "archive" ? new Date().toISOString() : null }
      );
      refreshConversation(id);
    },
    [refreshConversation]
  );
  const headerActions = useConversationActions(onRemoved);
  const select = useCallback(
    (id: string, conv?: ConversationDto) => {
      setSelectedId(id);
      setOpenConv(conv ?? conversationsRef.current?.find((c) => c.id === id) ?? null);
      setMessages([]);
      void refetchMessages(id);
      void fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markRead: true }),
      });
    },
    [refetchMessages]
  );

  // Enlace directo desde Contactos/Pipeline: /inbox?contact=<id>
  const searchParams = useSearchParams();
  const contactParam = searchParams.get("contact");
  const contactOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!contactParam || selectedIdRef.current || !conversations) return;
    if (contactOpened.current === contactParam) return;
    contactOpened.current = contactParam;
    const match = conversations.find((c) => c.contact.id === contactParam);
    if (match) {
      select(match.id, match);
      return;
    }
    // Puede estar más abajo de lo cargado, o ser un chat de campaña sin
    // respuesta (041, fuera de la principal): se pide solo ese.
    let cancelled = false;
    void (async () => {
      for (const view of ["main", "campaigns"] as const) {
        const q = new URLSearchParams({ contactIds: contactParam });
        if (view === "campaigns") q.set("view", "campaigns");
        const res = await fetch(`/api/conversations?${q}`).catch(() => null);
        if (!res?.ok) return;
        const data = (await res.json()) as { conversations: ConversationDto[] };
        const c = data.conversations[0];
        if (cancelled || selectedIdRef.current) return;
        if (c) {
          select(c.id, c);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contactParam, conversations, select]);

  useEvents({
    onMessageNew: ({ conversationId, message }) => {
      if (selectedIdRef.current === conversationId) {
        const m = message as MessageDto;
        setMessages((prev) =>
          prev.some((x) => x.id === m.id) ? prev : [...prev, m]
        );
        void fetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ markRead: true }),
        });
      }
      scheduleRefresh((b) => b.addConversation(conversationId));
      // Un entrante nuevo puede crear/mover el lead: refresca el panel.
      setDetailRev((v) => v + 1);
    },
    onMessageStatus: ({ conversationId, messageId, status, error }) => {
      if (selectedIdRef.current !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                status: status as MessageDto["status"],
                error: error ?? null,
              }
            : m
        )
      );
    },
    onConversationUpdated: ({ conversation }) => {
      scheduleRefresh((b) => b.addConversation((conversation as { id?: string } | null)?.id));
      // El agente movió de etapa o cambió el handoff: refresca el panel en vivo.
      setDetailRev((v) => v + 1);
    },
    // 020: me asignaron o me quitaron chats (o, si reparto, cambió el reparto).
    onAssignmentChanged: ({ contactIds }) => {
      scheduleRefresh((b) => b.addContacts(contactIds));
      setDetailRev((v) => v + 1);
    },
    // 026: me sumaron o me quitaron como participante de un chat.
    onParticipantsChanged: ({ contactIds }) => {
      scheduleRefresh((b) => b.addContacts(contactIds));
      setDetailRev((v) => v + 1);
    },
    onReconnect: () => {
      // Catch-up tras reconexión (contrato sse.md): lista completa (lo que
      // pasó mientras no había canal no trae aviso).
      scheduleRefresh((b) => b.markFull(), true);
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      setDetailRev((v) => v + 1);
    },
  });

  const selected =
    conversations?.find((c) => c.id === selectedId) ??
    (openConv?.id === selectedId ? openConv : null);

  /**
   * Hilo visible = lo confirmado + lo que aún viaja. El mensaje real puede
   * llegar por refetch o por SSE antes de que retiremos el provisional, así
   * que cada pendiente se empareja con UN mensaje real (no por texto suelto:
   * mandar "hola" dos veces seguidas no debe borrar la segunda burbuja).
   */
  const thread = useMemo(() => {
    const propios = pending.filter((p) => p.conversationId === selectedId);
    if (propios.length === 0) return messages;
    const emparejados = new Set<string>();
    const visibles = propios.filter((p) => {
      const real = messages.find(
        (m) =>
          !emparejados.has(m.id) &&
          m.direction === "out" &&
          m.text === p.text &&
          Date.parse(m.createdAt) >= Date.parse(p.createdAt) - 60_000
      );
      if (real) emparejados.add(real.id);
      return !real;
    });
    if (visibles.length === 0) return messages;
    return [
      ...messages,
      ...visibles.map<MessageDto>((p) => ({
        id: p.id,
        conversationId: p.conversationId,
        direction: "out",
        type: "text",
        text: p.text,
        status: "pending",
        error: null,
        aiGenerated: false,
        origin: "operator",
        media: null,
        createdAt: p.createdAt,
      })),
    ];
  }, [messages, pending, selectedId]);

  /**
   * El compositor NO espera a que esto termine: limpia su campo al instante y
   * aquí se pinta la burbuja "enviando". Si el envío falla, la burbuja se
   * retira y el error vuelve al compositor, que devuelve el texto — un mensaje
   * jamás se pierde en silencio.
   */
  const sendText = useCallback(
    async (text: string): Promise<string | null> => {
      const conversationId = selectedIdRef.current;
      if (!conversationId) return "Sin conversación seleccionada";

      const tmpId = `tmp_${++tmpSeq.current}`;
      setPending((prev) => [
        ...prev,
        {
          id: tmpId,
          conversationId,
          text,
          createdAt: new Date().toISOString(),
        },
      ]);
      const drop = () => setPending((prev) => prev.filter((p) => p.id !== tmpId));

      const run = async (): Promise<string | null> => {
        const res = await fetch(`/api/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        }).catch(() => null);
        if (!res) {
          drop();
          return "Sin conexión con el servidor";
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          drop();
          return data?.error?.message ?? "No se pudo enviar el mensaje";
        }
        // Primero traer el mensaje real, después quitar el provisional: al
        // revés, la burbuja parpadearía.
        await refetchMessages(conversationId);
        drop();
        refreshConversation(conversationId);
        return null;
      };

      const queued = sendQueue.current.then(run, run);
      sendQueue.current = queued.catch(() => null);
      return queued;
    },
    [refetchMessages, refreshConversation]
  );

  const patchConversation = useCallback(
    async (patch: { aiEnabled?: boolean; reactivate?: boolean }) => {
      const id = selectedIdRef.current;
      if (!id) return;
      await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => null);
      refreshConversation(id);
    },
    [refreshConversation]
  );

  return (
    // Escritorio: lista, hilo y detalles son paneles separados que flotan
    // sobre el fondo base (ver `.shell-content` en globals.css).
    <div data-split-panels className="flex h-full lg:gap-3">
      {headerActions.element}
      {/* Móvil: una columna a la vez. La lista cede la pantalla completa al
          hilo en cuanto hay conversación elegida (patrón maestro-detalle). */}
      <section
        className={cn(
          "w-full shrink-0 overflow-hidden border-r md:w-[clamp(300px,32vw,340px)] lg:w-[clamp(340px,30vw,460px)]",
          "lg:rounded-panel lg:border lg:bg-surface lg:shadow-panel",
          selected && "max-md:hidden"
        )}
      >
        <ConversationList
          conversations={conversations}
          loadedKey={loadedKey}
          counts={counts}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          onListQuery={onListQuery}
          channels={channels}
          selectedId={selectedId}
          onSelect={select}
          onSeeded={onSeeded}
          onPatchRow={patchRow}
          onRemoved={onRemoved}
          directDefaultMode={direct && !direct.metaless ? direct.defaultMode : null}
        />
      </section>

      <section
        data-pm="chat"
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          "lg:overflow-hidden lg:rounded-panel lg:border lg:bg-surface lg:shadow-panel",
          !selected && "max-md:hidden"
        )}
      >
        {selected ? (
          <>
            {/* Al cambiar de chat, encabezado e hilo entran con un fundido
                corto (el compositor no: conserva su borrador). */}
            <m.div
              key={selected.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", duration: 0.2, bounce: 0 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              {/* 56 px, como la Bandeja y Detalles. Solo el nombre: el teléfono
                  está en Detalles y la ventana de 24 h, bajo el compositor. */}
              <header data-pm="chat-head" className="flex h-14 shrink-0 items-center justify-between gap-1 border-b bg-background px-2 md:px-4">
                {/* Volver a la lista: en móvil el hilo ocupa toda la pantalla. */}
                <button
                  onClick={() => setSelectedId(null)}
                  aria-label="Volver a las conversaciones"
                  className="shrink-0 rounded-md p-1.5 text-text-2 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
                >
                  <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
                </button>
                <div className="flex min-w-0 flex-1 items-center gap-3 px-1">
                  {direct && !direct.metaless ? (
                    <ChatModeDot
                      conversation={selected}
                      ctx={direct}
                      onChanged={(id, connectionMode) => patchRow(id, { connectionMode })}
                    >
                      <ContactAvatar
                        name={contactLabel(selected.contact)}
                        seed={selected.contact.id}
                        size="md"
                      />
                    </ChatModeDot>
                  ) : (
                    <ContactAvatar
                      name={contactLabel(selected.contact)}
                      seed={selected.contact.id}
                      size="md"
                    />
                  )}
                  <p className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold leading-tight tracking-tight">
                    {multiChannel && <ChannelBadge channel={selected.channel} />}
                    <span className="truncate">{contactLabel(selected.contact)}</span>
                  </p>
                </div>
                {/* 034: Archivar / Eliminar del chat abierto (las mismas opciones del
                    clic derecho de la fila; es también el camino con teclado). */}
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-label="Opciones del chat"
                  title="Opciones del chat"
                  onClick={(e) =>
                    headerActions.openMenu(selected, {
                      kind: "rect",
                      rect: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                  className="shrink-0 rounded-full border border-border-strong p-1.5 text-text-3 transition-colors hover:border-text-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MoreHorizontal className="h-4 w-4" strokeWidth={1.7} />
                </button>
                {!panelOpen && (
                  <button
                    onClick={() => togglePanel(true)}
                    aria-label="Mostrar detalles"
                    className="shrink-0 rounded-full border border-border-strong p-1.5 text-text-3 transition-colors hover:border-text-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PanelRight className="h-4 w-4" strokeWidth={1.7} />
                  </button>
                )}
              </header>
              <MessageThread messages={thread} />
            </m.div>
            <Composer
              conversation={selected}
              freeTextOutsideWindow={freeTextOutsideWindow(direct, selected)}
              directHint={!direct?.metaless}
              onSend={sendText}
              onSent={() => {
                const id = selectedIdRef.current;
                if (!id) return;
                void refetchMessages(id);
                refreshConversation(id);
              }}
            />
          </>
        ) : (
          <div className="thread-bg flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[24px] font-semibold leading-tight text-text-2">
              Elige una conversación para ver el hilo
            </p>
            <p className="kicker">Bandeja · tiempo real</p>
          </div>
        )}
      </section>

      {/* Velo del cajón de detalles (solo donde no caben tres columnas). */}
      {panelOpen && selected && (
        <button
          aria-label="Cerrar los detalles"
          tabIndex={-1}
          onClick={() => togglePanel(false)}
          className="fixed inset-0 z-30 bg-overlay xl:hidden"
        />
      )}

      <section
        className={cn(
          // xl: la sección es el HUECO de la columna y su ancho se anima con
          // el mismo tiempo y curva que el menú lateral, para que el hilo se
          // estire o encoja PEGADO al panel (sin hueco vacío). La tarjeta va
          // anclada a la izquierda del hueco: sale empujada hacia la derecha
          // y entra desde ahí. Solo se reacomoda el hilo (la lista tiene
          // ancho fijo).
          "shrink-0 overflow-hidden border-l xl:overflow-visible xl:border-0",
          "xl:transition-[width,margin-left] xl:duration-nav xl:ease-panel",
          // Debajo de xl no hay ancho para una tercera columna: el panel se
          // vuelve un cajón que entra desde la derecha, encima del hilo.
          "max-xl:fixed max-xl:inset-y-0 max-xl:right-0 max-xl:z-40 max-xl:w-auto max-xl:bg-popover max-xl:transition-transform max-xl:duration-nav max-xl:ease-panel",
          // Cerrado mide 0 y el margen negativo se come el hueco del `gap`.
          panelOpen && selected
            ? "w-[320px] max-xl:translate-x-0 max-xl:shadow-pop"
            : "w-0 border-l-0 max-xl:translate-x-full xl:-ml-3"
        )}
      >
        {selected && (
          <div
            className={cn(
              "h-full w-[320px] max-xl:w-[min(320px,88vw)]",
              // xl: el tercer panel flotante, que entra y sale deslizándose.
              "xl:overflow-hidden xl:rounded-panel xl:border xl:bg-surface xl:shadow-panel",
              "xl:transition-opacity xl:duration-nav xl:ease-panel",
              panelOpen ? "xl:opacity-100" : "xl:pointer-events-none xl:opacity-0"
            )}
          >
            {/* key por contacto: el panel y sus tarjetas (asignación,
                participantes, etiquetas) guardan estado propio; sin esto, al
                cambiar de chat asoman los datos del contacto anterior. */}
            <ContactPanel
              key={selected.contact.id}
              conversation={selected}
              refreshKey={detailRev}
              onPatchConversation={patchConversation}
              onClose={() => togglePanel(false)}
            />
          </div>
        )}
      </section>
    </div>
  );
}
