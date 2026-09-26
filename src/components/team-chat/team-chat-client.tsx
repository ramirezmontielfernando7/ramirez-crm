"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, m } from "motion/react";
import { ChevronLeft, Eye, Megaphone, MessageSquarePlus, Search, ShieldAlert, Users } from "lucide-react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import {
  OVERSIGHT_NOTICE,
  type TeamChatListResponse,
  type TeamMessageDto,
  type TeamPersonDto,
  type TeamThreadDto,
} from "@/lib/team-chat";
import { matchesQuery } from "@/lib/search";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { ENTER, SPRING } from "@/components/motion";
import { NavRevealButton } from "@/components/nav-mode";
import { useEvents } from "@/components/use-events";
import { useViewer } from "@/components/viewer-context";
import { formatTime } from "@/components/inbox/helpers";
import { refreshTeamUnread, setActiveThread } from "./unread-store";
import { TeamThread } from "./team-thread";
import { TeamComposer } from "./team-composer";

type ThreadState = {
  threadId: string;
  messages: TeamMessageDto[];
  hasMore: boolean;
  relation: "member" | "oversight";
  canPost: boolean;
  canReact: boolean;
};

/**
 * 025 — Chat de equipo: comunicación INTERNA entre usuarios de la
 * organización (los clientes no participan). Lista a la izquierda (avisos,
 * directos, grupos y, si el Propietario supervisa, los ajenos en solo
 * lectura) y el hilo a la derecha, como la Bandeja.
 */
export function TeamChatClient() {
  const viewer = useViewer();
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("t");
  const [list, setList] = useState<TeamChatListResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const select = useCallback(
    (id: string | null) => {
      router.replace(id ? `/chat?t=${encodeURIComponent(id)}` : "/chat", { scroll: false });
    },
    [router]
  );

  const refetchList = useCallback(async () => {
    const res = await fetchJson<TeamChatListResponse>("/api/team-chat/threads");
    if (!res.ok) {
      setListError(`No se pudo cargar el chat de equipo: ${res.error}`);
      return;
    }
    setListError(null);
    setList(res.data);
  }, []);

  const markRead = useCallback(async (id: string) => {
    if (document.visibilityState !== "visible") return;
    const res = await fetchJson<{ marked: boolean }>(`/api/team-chat/threads/${id}/read`, { method: "POST" });
    if (!res.ok) {
      setThreadError(`No se pudo marcar como leído: ${res.error}`);
      return;
    }
    if (res.data.marked) {
      refreshTeamUnread();
      setList((l) =>
        l ? { ...l, threads: l.threads.map((t) => (t.id === id ? { ...t, unread: 0 } : t)) } : l
      );
    }
  }, []);

  const loadThread = useCallback(
    async (id: string) => {
      const res = await fetchJson<Omit<ThreadState, "threadId">>(`/api/team-chat/threads/${id}/messages?limit=50`);
      if (selectedRef.current !== id) return;
      if (!res.ok) {
        setThread(null);
        setThreadError(
          res.status === 404 ? "Esta conversación no existe o ya no tienes acceso." : `No se pudo abrir: ${res.error}`
        );
        return;
      }
      setThreadError(null);
      setThread({ threadId: id, ...res.data });
      if (res.data.relation === "member") void markRead(id);
    },
    [markRead]
  );

  useEffect(() => {
    void refetchList();
  }, [refetchList]);

  useEffect(() => {
    setActiveThread(selectedId);
    setThread(null);
    setThreadError(null);
    if (selectedId) void loadThread(selectedId);
    return () => setActiveThread(null);
  }, [selectedId, loadThread]);

  // Volver a la pestaña con un hilo abierto = leerlo.
  useEffect(() => {
    const onVisible = () => {
      const id = selectedRef.current;
      if (document.visibilityState === "visible" && id && thread?.relation === "member") void markRead(id);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead, thread?.relation]);

  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleList = useCallback(() => {
    if (listTimer.current) clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => void refetchList(), 200);
  }, [refetchList]);

  const upsert = useCallback((message: TeamMessageDto) => {
    setThread((t) => {
      if (!t || t.threadId !== message.threadId) return t;
      const i = t.messages.findIndex((x) => x.id === message.id);
      const messages = i === -1 ? [...t.messages, message] : t.messages.map((x) => (x.id === message.id ? message : x));
      return { ...t, messages };
    });
  }, []);

  useEvents({
    onTeamMessage: (data) => {
      scheduleList();
      if (data.threadId !== selectedRef.current) return;
      const message = data.message as TeamMessageDto;
      upsert(message);
      // Lo que llega de otros con el hilo a la vista queda leído (lo propio ya lo está).
      if (data.change === "new" && message.author?.id !== viewer.userId) void markRead(data.threadId);
    },
    onTeamThread: (data) => {
      scheduleList();
      const id = selectedRef.current;
      if (!id) return;
      // Borrado, sacado del grupo o cambió la supervisión: se vuelve a pedir
      // (si ya no hay acceso, el hilo lo explica en vez de quedarse viejo).
      if (data.change === "settings" || data.threadId === id) {
        if (data.change !== "read") void loadThread(id);
      }
    },
    // Lo publicado entre la carga y la conexión del SSE no llega por el canal.
    onConnect: () => {
      void refetchList();
      if (selectedRef.current) void loadThread(selectedRef.current);
    },
    onReconnect: () => {
      void refetchList();
      if (selectedRef.current) void loadThread(selectedRef.current);
    },
  });

  async function loadOlder() {
    if (!thread || loadingOlder || !thread.messages[0]) return;
    setLoadingOlder(true);
    const res = await fetchJson<{ messages: TeamMessageDto[]; hasMore: boolean }>(
      `/api/team-chat/threads/${thread.threadId}/messages?limit=50&before=${encodeURIComponent(thread.messages[0].id)}`
    );
    setLoadingOlder(false);
    if (!res.ok) {
      setThreadError(`No se pudieron cargar los anteriores: ${res.error}`);
      return;
    }
    setThread((t) =>
      t && t.threadId === thread.threadId
        ? { ...t, messages: [...res.data.messages, ...t.messages], hasMore: res.data.hasMore }
        : t
    );
  }

  const selected = list?.threads.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <section
        className={cn("w-full shrink-0 overflow-hidden border-r md:w-[300px] lg:w-[360px]", selectedId && "max-md:hidden")}
      >
        <ThreadList
          list={list}
          error={listError}
          selectedId={selectedId}
          onSelect={select}
          onRetry={() => void refetchList()}
          onOpened={(id) => {
            void refetchList();
            select(id);
          }}
        />
      </section>

      <section className={cn("flex min-w-0 flex-1 flex-col", !selectedId && "max-md:hidden")}>
        {selectedId ? (
          <>
            <header className="flex h-14 shrink-0 items-center gap-1 border-b bg-background px-2 md:px-4">
              <button
                onClick={() => select(null)}
                aria-label="Volver a las conversaciones"
                className="shrink-0 rounded-md p-1.5 text-text-2 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
              </button>
              {selected && (
                <div className="flex min-w-0 flex-1 items-center gap-3 px-1">
                  <ThreadAvatar thread={selected} userId={viewer.userId} />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold leading-tight tracking-tight">{selected.title}</p>
                    <p className="truncate text-[11.5px] text-text-3">{subtitle(selected, viewer.userId)}</p>
                  </div>
                  {selected.relation === "oversight" && (
                    <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-warning-tint px-2 py-0.5 text-[11px] font-semibold text-warning-text">
                      <Eye className="h-3 w-3" strokeWidth={2} /> Supervisión · solo lectura
                    </span>
                  )}
                </div>
              )}
            </header>
            {threadError && (
              <p role="alert" className="border-b border-danger-soft bg-danger-tint px-4 py-2 text-[12.5px] text-danger-text">
                {threadError}
              </p>
            )}
            {thread && selected ? (
              <>
                <m.div
                  key={thread.threadId}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={SPRING}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <TeamThread
                    kind={selected.kind}
                    userId={viewer.userId}
                    messages={thread.messages}
                    hasMore={thread.hasMore}
                    loadingOlder={loadingOlder}
                    canReact={thread.canReact}
                    onLoadOlder={() => void loadOlder()}
                    onChanged={upsert}
                  />
                </m.div>
                <TeamComposer
                  threadId={thread.threadId}
                  kind={selected.kind}
                  canPost={thread.canPost}
                  relation={thread.relation}
                  onSent={(message) => {
                    if (message) upsert(message);
                    scheduleList();
                  }}
                />
              </>
            ) : (
              !threadError && <p className="thread-bg flex-1 p-6 text-center text-xs text-text-3">Cargando…</p>
            )}
          </>
        ) : (
          <div className="thread-bg flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="font-serif text-[24px] italic leading-tight text-text-2">Elige una conversación del equipo</p>
            <p className="kicker">Chat de equipo · tiempo real</p>
          </div>
        )}
      </section>
    </div>
  );
}

function subtitle(t: TeamThreadDto, userId: string): string {
  if (t.kind === "announcements") return "Todo el equipo · canal de avisos";
  if (t.kind === "direct") {
    const other = t.members.find((p) => p.id !== userId);
    return t.relation === "oversight" ? "Directo entre dos personas del equipo" : (other?.role ?? "Directo");
  }
  return `${t.members.length} ${t.members.length === 1 ? "participante" : "participantes"}`;
}

function ThreadAvatar({ thread, userId }: { thread: TeamThreadDto; userId: string }) {
  if (thread.kind === "direct" && thread.relation === "member") {
    const other = thread.members.find((p) => p.id !== userId);
    return <ContactAvatar name={thread.title} seed={other?.id ?? thread.id} size="list" />;
  }
  const Icon = thread.kind === "announcements" ? Megaphone : thread.kind === "group" ? Users : Eye;
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text">
      <Icon className="h-4 w-4" strokeWidth={1.8} />
    </span>
  );
}

function ThreadList({
  list,
  error,
  selectedId,
  onSelect,
  onRetry,
  onOpened,
}: {
  list: TeamChatListResponse | null;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onOpened: (id: string) => void;
}) {
  const viewer = useViewer();
  const [newOpen, setNewOpen] = useState(false);
  const own = list?.threads.filter((t) => t.relation === "member") ?? [];
  const supervised = list?.threads.filter((t) => t.relation === "oversight") ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <NavRevealButton />
        <h2 className="text-[17px] font-bold tracking-tight">Chat de equipo</h2>
        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setNewOpen((v) => !v)}
            aria-label="Nuevo mensaje directo"
            aria-expanded={newOpen}
            title="Nuevo mensaje directo"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border border-border-strong text-text-2 transition-colors hover:border-text-3 hover:text-foreground",
              newOpen && "border-brand text-brand"
            )}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <AnimatePresence>
            {newOpen && (
              <NewDirect
                onClose={() => setNewOpen(false)}
                onOpened={(id) => {
                  setNewOpen(false);
                  onOpened(id);
                }}
              />
            )}
          </AnimatePresence>
        </div>
      </header>

      {list?.overseeing && (
        <div className="flex items-start gap-2 border-b bg-warning-tint px-4 py-2 text-[12px] leading-snug text-warning-text">
          <Eye className="mt-[1px] h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span>
            <span className="font-semibold">Supervisión activa.</span> Ves también los directos y grupos del equipo, en
            solo lectura. Se desactiva en Ajustes → Chat de equipo.
          </span>
        </div>
      )}
      {list?.oversightNotice && (
        <div className="flex items-start gap-2 border-b bg-info-tint px-4 py-2 text-[12px] leading-snug text-info-text">
          <ShieldAlert className="mt-[1px] h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span>{OVERSIGHT_NOTICE}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="p-6 text-center">
            <p role="alert" className="text-[12.5px] text-danger-text">
              {error}
            </p>
            <button type="button" onClick={onRetry} className="mt-2 text-[12.5px] font-semibold text-brand-ink hover:underline">
              Reintentar
            </button>
          </div>
        ) : !list ? (
          <p className="p-6 text-center text-xs text-text-3">Cargando…</p>
        ) : (
          <>
            <Rows threads={own} selectedId={selectedId} onSelect={onSelect} userId={viewer.userId} />
            {own.length <= 1 && (
              <p className="px-4 py-4 text-center text-[12px] text-text-3">
                Abre un directo con <MessageSquarePlus className="inline h-3.5 w-3.5" strokeWidth={1.8} /> para escribirle a
                alguien del equipo.
              </p>
            )}
            {supervised.length > 0 && (
              <>
                <p className="kicker border-y bg-subtle px-4 py-1.5 text-text-2">Supervisión · solo lectura</p>
                <Rows threads={supervised} selectedId={selectedId} onSelect={onSelect} userId={viewer.userId} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Rows({
  threads,
  selectedId,
  onSelect,
  userId,
}: {
  threads: TeamThreadDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  userId: string;
}) {
  return (
    <ul>
      {threads.map((t, index) => {
        const active = t.id === selectedId;
        const unread = t.unread > 0;
        return (
          <m.li
            key={t.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...ENTER, delay: Math.min(index, 10) * 0.018 }}
            className="relative after:absolute after:bottom-0 after:left-[58px] after:right-0 after:h-px after:bg-border"
          >
            {active && (
              <m.span
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={SPRING}
                className="absolute inset-y-0 left-0 w-[3px] bg-brand"
              />
            )}
            <button
              onClick={() => onSelect(t.id)}
              className={cn(
                "flex w-full items-start gap-2.5 px-4 py-[var(--row-py)] text-left transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                active ? "bg-[var(--bg-active)]" : "hover:bg-row-hover"
              )}
            >
              <span className="mt-[3px] shrink-0">
                <ThreadAvatar thread={t} userId={userId} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "truncate text-[13.5px] leading-5 tracking-[-0.01em] text-foreground",
                      unread ? "font-bold" : "font-semibold"
                    )}
                  >
                    {t.title}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[11px] leading-5 tabular-nums",
                      unread ? "font-semibold text-brand-ink" : "font-medium text-text-3"
                    )}
                  >
                    {formatTime(t.lastMessageAt)}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-[12.5px] leading-[18px]", unread ? "font-medium text-foreground" : "text-text-2")}>
                    {t.lastMessagePreview || (t.kind === "announcements" ? "Avisos para todo el equipo" : "Sin mensajes todavía")}
                  </span>
                  {unread && (
                    <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-semibold tabular-nums leading-none text-brand-fg">
                      {t.unread}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </m.li>
        );
      })}
    </ul>
  );
}

/** Buscador de compañeros para abrir (o reutilizar) un directo. */
function NewDirect({ onClose, onOpened }: { onClose: () => void; onOpened: (id: string) => void }) {
  const viewer = useViewer();
  const ref = useRef<HTMLDivElement>(null);
  const [people, setPeople] = useState<TeamPersonDto[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ people: TeamPersonDto[] }>("/api/team-chat/people").then((res) => {
      if (cancelled) return;
      if (!res.ok) setError(`No se pudo cargar el equipo: ${res.error}`);
      else setPeople(res.data.people.filter((p) => p.id !== viewer.userId));
    });
    return () => {
      cancelled = true;
    };
  }, [viewer.userId]);

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

  async function open(userId: string) {
    setOpening(userId);
    setError(null);
    const res = await fetchJson<{ threadId: string }>("/api/team-chat/threads", jsonInit("POST", { userId }));
    setOpening(null);
    if (!res.ok) {
      setError(`No se pudo abrir el directo: ${res.error}`);
      return;
    }
    onOpened(res.data.threadId);
  }

  const shown = (people ?? []).filter((p) => matchesQuery(query, { text: [p.name, p.role] }));

  return (
    <m.div
      ref={ref}
      role="dialog"
      aria-label="Nuevo mensaje directo"
      initial={{ opacity: 0, y: -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -2, scale: 0.98, transition: { duration: 0.1 } }}
      transition={SPRING}
      style={{ transformOrigin: "top right" }}
      className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-md border bg-popover text-foreground shadow-pop"
    >
      <div className="flex items-center gap-2 border-b px-2.5 py-2">
        <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.7} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar en el equipo…"
          aria-label="Buscar en el equipo"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-3 max-sm:text-base"
        />
      </div>
      {error && (
        <p role="alert" className="px-3 py-2 text-[12px] text-danger-text">
          {error}
        </p>
      )}
      <ul className="max-h-72 overflow-y-auto py-1">
        {people === null && !error && <li className="px-3 py-2 text-xs text-text-3">Cargando…</li>}
        {people !== null && shown.length === 0 && (
          <li className="px-3 py-2 text-xs text-text-3">
            {people.length === 0 ? "Todavía no hay nadie más en el equipo" : "Nadie coincide"}
          </li>
        )}
        {shown.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              disabled={opening !== null}
              onClick={() => void open(p.id)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-row-hover disabled:opacity-60"
            >
              <ContactAvatar name={p.name} seed={p.id} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{p.name}</span>
                <span className="block truncate text-[11px] text-text-3">{p.role}</span>
              </span>
              {opening === p.id && <span className="text-[11px] text-text-3">Abriendo…</span>}
            </button>
          </li>
        ))}
      </ul>
    </m.div>
  );
}
