"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Lock, UserCheck } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { MY_CHATS_TEXT } from "@/lib/mi-numero";
import type { MessageDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { NavRevealButton } from "@/components/nav-mode";
import { useEvents } from "@/components/use-events";
import { formatTime, previewText } from "./helpers";
import { InboxModeSwitch, InboxTabs } from "./inbox-mode-switch";
import { MessageBubble } from "./message-bubble";
import { refreshNumberUnread } from "./number-unread-store";

type MyChat = {
  id: string;
  contact: { id: string; name: string; phone: string | null; inCrm: boolean };
  preview: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  clientMarkedAt: string | null;
};
type MyChats = { numberId: string; shareClients: boolean; chats: MyChat[] };

/**
 * Mi número (046), PR 4 — La pestaña «Mi número» de la Bandeja: los chats del
 * número de quien mira (solo él los ve; la API lo decide por la sesión), sus
 * mensajes y «Es cliente». Contestar desde aquí llega en el PR 5.
 */
export function MyNumberInbox() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("c");
  const [list, setList] = useState<MyChats | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[] | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const refetchList = useCallback(async () => {
    const res = await fetchJson<MyChats>("/api/my-number/chats");
    if (res.ok) {
      setList(res.data);
      setListError(null);
    } else setListError(res.error);
  }, []);

  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleList = useCallback(() => {
    if (listTimer.current) clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => void refetchList(), 200);
  }, [refetchList]);

  const loadThread = useCallback(async (id: string) => {
    const res = await fetchJson<{ messages: MessageDto[] }>(`/api/my-number/chats/${id}/messages`);
    if (selectedRef.current !== id) return;
    if (res.ok) {
      setMessages(res.data.messages);
      setThreadError(null);
      // Abrirlo lo deja leído: la lista y el globo de la pestaña se ponen al día.
      scheduleList();
      refreshNumberUnread();
    } else setThreadError(res.error);
  }, [scheduleList]);

  useEffect(() => {
    void refetchList();
  }, [refetchList]);

  useEffect(() => {
    setMessages(null);
    setThreadError(null);
    if (selectedId) void loadThread(selectedId);
  }, [selectedId, loadThread]);

  useEvents({
    onNumberMessage: ({ conversationId, message }) => {
      scheduleList();
      if (conversationId !== selectedRef.current) return;
      const m = message as MessageDto;
      setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev));
      // Lo estoy viendo: que quede leído.
      void loadThread(conversationId);
    },
    onNumberConversation: () => scheduleList(),
    onConnect: () => {
      scheduleList();
      if (selectedRef.current) void loadThread(selectedRef.current);
    },
  });

  const select = (id: string | null) => router.replace(id ? `/inbox/mi-numero?c=${id}` : "/inbox/mi-numero", { scroll: false });

  async function markClient(chat: MyChat) {
    if (!window.confirm(MY_CHATS_TEXT.markClientConfirm)) return;
    setBusy(true);
    const res = await fetchJson<null>(`/api/my-number/chats/${chat.id}/client`, { method: "POST" });
    setBusy(false);
    if (!res.ok) return setThreadError(res.error);
    await refetchList();
  }

  const selected = list?.chats.find((c) => c.id === selectedId) ?? null;

  return (
    <div data-split-panels className="flex h-full lg:gap-3">
      <section
        className={cn(
          "w-full shrink-0 overflow-hidden border-r md:w-[300px] lg:w-[360px]",
          "lg:rounded-panel lg:border lg:bg-surface lg:shadow-panel",
          selectedId && "max-md:hidden"
        )}
      >
        <div className="flex h-full flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 px-4">
            <NavRevealButton />
            <InboxModeSwitch current="number" />
          </header>
          <InboxTabs current="number" />
          <p className="flex items-start gap-2 border-y bg-secondary px-4 py-2 text-[12px] leading-snug text-text-2">
            <Lock className="mt-[1px] h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            <span>{MY_CHATS_TEXT.privacy}</span>
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="my-number-chats">
            {listError && (
              <p role="alert" className="px-4 py-3 text-[12.5px] text-danger-text">
                {listError}{" "}
                <button type="button" className="underline" onClick={() => void refetchList()}>
                  Reintentar
                </button>
              </p>
            )}
            {!list && !listError && <p className="px-4 py-6 text-center text-xs text-text-3">Cargando…</p>}
            {list?.chats.length === 0 && <p className="px-6 py-10 text-center text-[13px] text-text-3">{MY_CHATS_TEXT.empty}</p>}
            {list?.chats.map((c) => (
              <ChatRow key={c.id} chat={c} active={c.id === selectedId} onSelect={() => select(c.id)} />
            ))}
          </div>
        </div>
      </section>

      <section
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          "lg:overflow-hidden lg:rounded-panel lg:border lg:bg-surface lg:shadow-panel",
          !selectedId && "max-md:hidden"
        )}
      >
        {selectedId ? (
          <>
            <header className="flex h-14 shrink-0 items-center gap-1 border-b bg-background px-2 md:px-4">
              <button
                onClick={() => select(null)}
                aria-label="Volver a los chats"
                className="shrink-0 rounded-md p-1.5 text-text-2 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
              </button>
              {selected && (
                <div className="flex min-w-0 flex-1 items-center gap-3 px-1">
                  <ContactAvatar name={selected.contact.name} size="list" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-[15px] font-semibold leading-tight tracking-tight">
                      <span className="truncate">{selected.contact.name}</span>
                      {selected.clientMarkedAt && <ClientChip />}
                    </p>
                    <p className="truncate text-[11.5px] text-text-3">
                      Por tu número{selected.contact.phone ? ` · +${selected.contact.phone}` : ""}
                    </p>
                  </div>
                  {!selected.clientMarkedAt && (
                    <div className="ml-auto shrink-0">
                      {list?.shareClients ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          title={MY_CHATS_TEXT.markClientHelp}
                          onClick={() => void markClient(selected)}
                          data-testid="my-number-mark-client"
                        >
                          <UserCheck className="mr-1.5 h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                          {MY_CHATS_TEXT.markClient}
                        </Button>
                      ) : (
                        <Link
                          href="/settings/my-number"
                          title={MY_CHATS_TEXT.shareOff}
                          className="hidden text-[11.5px] text-text-3 underline-offset-2 hover:underline sm:inline"
                        >
                          ¿Es cliente? Actívalo en tus ajustes
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )}
            </header>
            {threadError && (
              <p role="alert" className="border-b border-danger-soft bg-danger-tint px-4 py-2 text-[12.5px] text-danger-text">
                {threadError}
              </p>
            )}
            {messages ? (
              <Messages messages={messages} />
            ) : (
              !threadError && <p className="thread-bg flex-1 p-6 text-center text-xs text-text-3">Cargando…</p>
            )}
            <p className="shrink-0 border-t bg-background px-4 py-3 text-center text-[12.5px] text-text-3">{MY_CHATS_TEXT.replySoon}</p>
          </>
        ) : (
          <div className="thread-bg flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[24px] font-semibold leading-tight text-text-2">{MY_CHATS_TEXT.pick}</p>
            <p className="kicker">Mi número · privado</p>
          </div>
        )}
      </section>
    </div>
  );
}

function ClientChip() {
  return (
    <span className="shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-semibold text-brand-text">{MY_CHATS_TEXT.client}</span>
  );
}

function ChatRow({ chat, active, onSelect }: { chat: MyChat; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      data-testid="my-number-chat"
      className={cn(
        "flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active ? "bg-brand-tint" : "hover:bg-accent"
      )}
    >
      <ContactAvatar name={chat.contact.name} size="list" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-[13.5px]", chat.unreadCount > 0 ? "font-bold" : "font-semibold")}>{chat.contact.name}</span>
          <span className="shrink-0 text-[11px] text-text-3">{formatTime(chat.lastMessageAt)}</span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-[12.5px] text-text-2">{previewText(chat.preview)}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {chat.clientMarkedAt ? (
              <ClientChip />
            ) : (
              <span className="flex items-center gap-1 text-[11px] text-text-3">
                <Lock className="h-3 w-3" strokeWidth={2} aria-hidden />
                {MY_CHATS_TEXT.private}
              </span>
            )}
            {chat.unreadCount > 0 && (
              <span
                aria-label={`${chat.unreadCount} sin leer`}
                className="min-w-[18px] rounded-full bg-brand px-1.5 text-center text-[11px] font-semibold leading-[18px] text-primary-foreground"
              >
                {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
              </span>
            )}
          </span>
        </span>
      </span>
    </button>
  );
}

function Messages({ messages }: { messages: MessageDto[] }) {
  const end = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);
  return (
    <div className="thread-bg flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-4 md:px-6" data-testid="my-number-thread">
      {messages.length === 0 && <p className="m-auto text-xs text-text-3">Sin mensajes todavía.</p>}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const grouped = !!prev && prev.direction === m.direction;
        return (
          <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start", !grouped && i > 0 && "mt-2")}>
            <MessageBubble m={m} grouped={grouped} />
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
