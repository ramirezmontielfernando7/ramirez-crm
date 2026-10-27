"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Bot, ChevronLeft, ChevronRight, Lock, PanelRight, UserCheck } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { ACCESS_TEXT, MY_CHATS_TEXT, TEAM_TEXT } from "@/lib/mi-numero";
import type { ConversationDto, MessageDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { NavRevealButton } from "@/components/nav-mode";
import { useEvents } from "@/components/use-events";
import { useViewer } from "@/components/viewer-context";
import { useAssignees } from "@/components/assignment/use-assignees";
import { AssigneeCapsule, StageCapsule, TagsCapsule } from "./chat-capsules";
import { Composer } from "./composer";
import { ContactPanel } from "./contact-panel";
import { useInboxCatalogs } from "./use-inbox-catalogs";
import { formatTime, previewText } from "./helpers";
import { InboxModeSwitch, InboxTabs } from "./inbox-mode-switch";
import { MessageBubble } from "./message-bubble";
import { refreshNumberUnread } from "./number-unread-store";
import { AccessRequestDialog, OverlapPills, PendingRequestsBanner, SharedChatsSection, useAccessOverview } from "./my-number-access";
import { CompanyNumbersSection, findCompanyChat, RequestableSection, useTeamNumbers } from "./my-number-team";

type MyChat = {
  id: string;
  contact: { id: string; name: string; phone: string | null; inCrm: boolean };
  preview: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  clientMarkedAt: string | null;
  ai: "on" | "paused" | null;
  /** Lo de CRM (etapa, etiquetas, quién atiende) en un chat de cliente; null en los privados. */
  crm: ConversationDto | null;
};
type MyChats = { numberId: string; shareClients: boolean; chats: MyChat[] };

/**
 * Mi número (046), PR 4 — La pestaña «Mi número» de la Bandeja: los chats del
 * número de quien mira (solo él los ve; la API lo decide por la sesión), sus
 * mensajes, «Es cliente» y (PR 5) contestar: sale por SU número. PR 6:
 * «También habla con…», las solicitudes para ver mis chats y, en solo
 * lectura, los chats que otros me dejaron ver (`?s=`). PR 7: quien supervisa
 * (`team`) lee los números de la empresa (`?e=`, solo lectura) y pide ver
 * chats de cliente de números personales; sin número propio (`own` false)
 * solo ve eso.
 */
export function MyNumberInbox({ own = true, team = false }: { own?: boolean; team?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const sharedId = params.get("s");
  const companyId = params.get("e");
  const selectedId = params.get("c") ?? sharedId ?? companyId;
  const [list, setList] = useState<MyChats | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[] | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [version, setVersion] = useState(0);
  const [queued, setQueued] = useState(false);
  const { overview, reload: reloadAccess } = useAccessOverview();
  const { team: teamData, reload: reloadTeam } = useTeamNumbers(team);
  const [rowError, setRowError] = useState<string | null>(null);
  const catalogs = useInboxCatalogs();
  const members = useAssignees();
  const capsuleCatalogs = useMemo(() => ({ catalogs, members }), [catalogs, members]);
  const [panelOpen, setPanelOpen] = useState(false);
  // Detalles a la derecha, como en Empresa: misma preferencia guardada y
  // solo abierto de inicio donde caben tres columnas.
  useEffect(() => {
    try {
      if (window.matchMedia("(min-width: 1280px)").matches) setPanelOpen(localStorage.getItem("vocero.panelOpen") !== "false");
    } catch {}
  }, []);
  const togglePanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    try {
      if (window.matchMedia("(min-width: 1280px)").matches) localStorage.setItem("vocero.panelOpen", String(open));
    } catch {}
  }, []);
  const [detailRev, setDetailRev] = useState(0);
  const sharedRef = useRef(sharedId);
  sharedRef.current = sharedId;
  const companyRef = useRef(companyId);
  companyRef.current = companyId;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const refetchList = useCallback(async () => {
    if (!own) return;
    const res = await fetchJson<MyChats>("/api/my-number/chats");
    if (res.ok) {
      setList(res.data);
      setListError(null);
    } else setListError(res.error);
  }, [own]);

  /** Una cápsula cambió algo de CRM: se pinta al instante (como en Empresa). */
  const patchRow = useCallback((id: string, patch: Partial<ConversationDto>) => {
    setList((prev) =>
      prev
        ? {
            ...prev,
            chats: prev.chats.map((c) => (c.id === id && c.crm ? { ...c, crm: { ...c.crm, ...patch } } : c)),
          }
        : prev,
    );
    setDetailRev((v) => v + 1);
  }, []);

  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleList = useCallback(() => {
    if (listTimer.current) clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => {
      void refetchList();
      void reloadTeam();
    }, 200);
  }, [refetchList, reloadTeam]);

  const loadThread = useCallback(
    async (id: string) => {
      // Un chat compartido se lee aparte (solo lectura, queda en la bitácora de su dueño).
      // PR 7: uno de un número de la empresa, igual: solo lectura y anotado.
      const shared = sharedRef.current === id;
      const company = companyRef.current === id;
      const res = await fetchJson<{ messages: MessageDto[] }>(
        shared ? `/api/my-number/shared/${id}/messages` : company ? `/api/my-number/team/${id}/messages` : `/api/my-number/chats/${id}/messages`,
      );
      if (selectedRef.current !== id) return;
      if (res.ok && (shared || company)) {
        setMessages(res.data.messages);
        setThreadError(null);
      } else if (res.ok) {
        setMessages(res.data.messages);
        setThreadError(null);
        // Abrirlo lo deja leído: la lista y el globo de la pestaña se ponen al día.
        scheduleList();
        refreshNumberUnread();
      } else setThreadError(res.error);
    },
    [scheduleList],
  );

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
      // Lo estoy viendo: que quede leído (uno ajeno no se marca: ya llegó el mensaje).
      if (companyRef.current !== conversationId) void loadThread(conversationId);
    },
    onNumberConversation: ({ conversationId }) => {
      scheduleList();
      setDetailRev((v) => v + 1);
      // Solicitudes, accesos y avisos de «También habla con…».
      void reloadAccess();
      setVersion((v) => v + 1);
      // Palomitas o un envío que falló en el chat abierto: se vuelve a leer.
      if (conversationId === selectedRef.current && sharedRef.current !== conversationId && companyRef.current !== conversationId)
        void loadThread(conversationId);
    },
    onConnect: () => {
      scheduleList();
      if (selectedRef.current) void loadThread(selectedRef.current);
    },
  });

  const select = (id: string | null, kind: "c" | "s" | "e" = "c") =>
    router.replace(id ? `/inbox/mi-numero?${kind}=${id}` : "/inbox/mi-numero", {
      scroll: false,
    });

  async function markClient(chat: MyChat) {
    if (!window.confirm(MY_CHATS_TEXT.markClientConfirm)) return;
    setBusy(true);
    const res = await fetchJson<null>(`/api/my-number/chats/${chat.id}/client`, { method: "POST" });
    setBusy(false);
    if (!res.ok) return setThreadError(res.error);
    await refetchList();
  }

  async function sendText(conversationId: string, text: string): Promise<string | null> {
    const res = await fetchJson<{ queuedUntil?: string }>(`/api/my-number/chats/${conversationId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return res.error;
    setQueued(!!res.data.queuedUntil);
    scheduleList();
    void loadThread(conversationId);
    return null;
  }

  const selected = sharedId || companyId ? null : (list?.chats.find((c) => c.id === selectedId) ?? null);
  const companyChat = findCompanyChat(teamData, companyId);
  const sharedChat = sharedId ? (overview?.sharedWithMe.find((c) => c.conversationId === sharedId) ?? null) : null;
  const request = reviewing ? (overview?.incoming[0] ?? null) : null;

  return (
    <div data-split-panels className="flex h-full lg:gap-3">
      <section
        className={cn(
          "w-full shrink-0 overflow-hidden border-r md:w-[clamp(300px,32vw,340px)] lg:w-[clamp(340px,30vw,460px)]",
          "lg:rounded-panel lg:border lg:bg-surface lg:shadow-panel",
          selectedId && "max-md:hidden",
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
            <span>{own ? MY_CHATS_TEXT.privacy : TEAM_TEXT.note}</span>
          </p>
          <PendingRequestsBanner requests={overview?.incoming ?? []} onReview={() => setReviewing(true)} />
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="my-number-chats">
            {listError && (
              <p role="alert" className="px-4 py-3 text-[12.5px] text-danger-text">
                {listError}{" "}
                <button type="button" className="underline" onClick={() => void refetchList()}>
                  Reintentar
                </button>
              </p>
            )}
            {own && !list && !listError && <p className="px-4 py-6 text-center text-xs text-text-3">Cargando…</p>}
            {list?.chats.length === 0 && <p className="px-6 py-10 text-center text-[13px] text-text-3">{MY_CHATS_TEXT.empty}</p>}
            {!own && teamData && teamData.companyNumbers.length === 0 && teamData.requestable.length === 0 && !overview?.sharedWithMe.length && (
              <p className="px-6 py-10 text-center text-[13px] text-text-3">{TEAM_TEXT.nothing}</p>
            )}
            {rowError && (
              <p role="alert" className="flex items-start justify-between gap-2 border-b bg-danger-tint px-4 py-2 text-[12px] text-danger-text">
                {rowError}
                <button type="button" className="underline" onClick={() => setRowError(null)}>
                  Cerrar
                </button>
              </p>
            )}
            <CapsuleCatalogs.Provider value={capsuleCatalogs}>
              {list?.chats.map((c) => (
                <ChatRow
                  key={c.id}
                  chat={c}
                  active={c.id === selectedId}
                  onSelect={() => select(c.id)}
                  onPatch={patchRow}
                  onRefetch={() => void refetchList()}
                  onError={setRowError}
                />
              ))}
            </CapsuleCatalogs.Provider>
            {teamData && <CompanyNumbersSection numbers={teamData.companyNumbers} activeId={companyId} onSelect={(id) => select(id, "e")} />}
            <SharedChatsSection chats={overview?.sharedWithMe ?? []} activeId={sharedId} onSelect={(id) => select(id, "s")} />
            {teamData && (
              <RequestableSection chats={teamData.requestable} onOpenShared={(id) => select(id, "s")} onChanged={() => void reloadTeam()} />
            )}
          </div>
        </div>
      </section>

      <section
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          "lg:overflow-hidden lg:rounded-panel lg:border lg:bg-surface lg:shadow-panel",
          !selectedId && "max-md:hidden",
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
                      Por tu número
                      {selected.contact.phone ? ` · +${selected.contact.phone}` : ""}
                    </p>
                  </div>
                  {selected.ai && (
                    <div className="ml-auto shrink-0">
                      <AiToggle chat={selected} onChanged={() => void refetchList()} onError={setThreadError} />
                    </div>
                  )}
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
              {companyChat && (
                <div className="flex min-w-0 flex-1 items-center gap-3 px-1">
                  <ContactAvatar name={companyChat.chat.contactName} size="list" />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold leading-tight tracking-tight">{companyChat.chat.contactName}</p>
                    <p className="truncate text-[11.5px] text-text-3">
                      {TEAM_TEXT.companyTitle(companyChat.number.ownerName, companyChat.number.label)}
                      {companyChat.chat.phone ? ` · +${companyChat.chat.phone}` : ""}
                    </p>
                  </div>
                </div>
              )}
              {sharedChat && (
                <div className="flex min-w-0 flex-1 items-center gap-3 px-1">
                  <ContactAvatar name={sharedChat.contactName} size="list" />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold leading-tight tracking-tight">{sharedChat.contactName}</p>
                    <p className="truncate text-[11.5px] text-text-3">{ACCESS_TEXT.sharedRow(sharedChat.ownerName)}</p>
                  </div>
                </div>
              )}
              {selected && !panelOpen && (
                <button
                  onClick={() => togglePanel(true)}
                  aria-label="Mostrar detalles"
                  className="ml-1 shrink-0 rounded-full border border-border-strong p-1.5 text-text-3 transition-colors hover:border-text-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PanelRight className="h-4 w-4" strokeWidth={1.7} />
                </button>
              )}
            </header>
            {selected?.clientMarkedAt && <OverlapPills conversationId={selected.id} version={version} onOpenShared={(id) => select(id, "s")} />}
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
            {companyId ? (
              <p className="shrink-0 border-t bg-background px-4 py-3 text-center text-[12.5px] text-text-3">
                {TEAM_TEXT.companyReadOnly(companyChat?.number.ownerName ?? "quien lleva el número")}
              </p>
            ) : sharedId ? (
              <p className="shrink-0 border-t bg-background px-4 py-3 text-center text-[12.5px] text-text-3">
                {ACCESS_TEXT.readOnly(sharedChat?.ownerName ?? "tu compañero")}
              </p>
            ) : (
              <>
                {queued && (
                  <p role="status" className="shrink-0 border-t bg-background px-4 pt-2 text-[12px] text-text-3">
                    {MY_CHATS_TEXT.queued}
                  </p>
                )}
                <Composer
                  key={selectedId}
                  numberChat
                  conversation={{
                    id: selectedId,
                    contact: selected?.contact ?? {
                      id: "",
                      name: "",
                      phone: null,
                    },
                    windowOpen: true,
                    windowRemainingMs: 0,
                  }}
                  onSend={(text) => sendText(selectedId, text)}
                  onSent={() => {
                    scheduleList();
                    void loadThread(selectedId);
                  }}
                />
              </>
            )}
          </>
        ) : (
          <div className="thread-bg flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[24px] font-semibold leading-tight text-text-2">{own ? MY_CHATS_TEXT.pick : TEAM_TEXT.pick}</p>
            <p className="kicker">{own ? "Mi número · privado" : "Números del equipo"}</p>
          </div>
        )}
      </section>
      {/* Detalles a la derecha, como en Empresa (cajón debajo de xl). */}
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
          "shrink-0 overflow-hidden border-l xl:overflow-visible xl:border-0",
          "xl:transition-[width,margin-left] xl:duration-nav xl:ease-panel",
          "max-xl:fixed max-xl:inset-y-0 max-xl:right-0 max-xl:z-40 max-xl:w-auto max-xl:bg-popover max-xl:transition-transform max-xl:duration-nav max-xl:ease-panel",
          panelOpen && selected ? "w-[320px] max-xl:translate-x-0 max-xl:shadow-pop" : "w-0 border-l-0 max-xl:translate-x-full xl:-ml-3",
        )}
      >
        {selected && (
          <div
            className={cn(
              "h-full w-[320px] max-xl:w-[min(320px,88vw)]",
              "xl:overflow-hidden xl:rounded-panel xl:border xl:bg-surface xl:shadow-panel",
              "xl:transition-opacity xl:duration-nav xl:ease-panel",
              panelOpen ? "xl:opacity-100" : "xl:pointer-events-none xl:opacity-0",
            )}
            data-testid="my-number-details"
          >
            {selected.crm ? (
              <ContactPanel
                key={selected.contact.id}
                conversation={selected.crm}
                refreshKey={detailRev}
                numberAi={null}
                onPatchConversation={async () => {}}
                onClose={() => togglePanel(false)}
              />
            ) : (
              <NumberChatDetails
                chat={selected}
                canMark={!!list?.shareClients}
                busy={busy}
                onMark={() => void markClient(selected)}
                onClose={() => togglePanel(false)}
              />
            )}
          </div>
        )}
      </section>
      {request && (
        <AccessRequestDialog
          key={request.id}
          request={request}
          onDone={() => {
            setReviewing(false);
            void reloadAccess();
          }}
        />
      )}
    </div>
  );
}

/** PR 8: la IA en este chat de cliente: activa (pausar) o en pausa (reanudar). */
function AiToggle({ chat, onChanged, onError }: { chat: MyChat; onChanged: () => void; onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  const on = chat.ai === "on";
  async function toggle() {
    setBusy(true);
    const res = await fetchJson<null>(`/api/my-number/chats/${chat.id}/ai`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: !on }),
    });
    setBusy(false);
    if (!res.ok) return onError(res.error);
    onChanged();
  }
  return (
    <span
      className={cn(
        "flex items-center gap-2 rounded-full py-1 pl-2.5 pr-1 text-[12px] font-semibold",
        on ? "bg-brand-tint text-brand-text" : "bg-warning-tint text-warning-text",
      )}
      data-testid="my-number-ai"
      title={on ? MY_CHATS_TEXT.aiOnHelp : MY_CHATS_TEXT.aiPausedHelp}
    >
      <Bot className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
      {on ? MY_CHATS_TEXT.aiOn : MY_CHATS_TEXT.aiPaused}
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className="rounded-full bg-background px-2.5 py-0.5 text-[11.5px] font-semibold text-foreground hover:bg-accent disabled:opacity-50"
        data-testid="my-number-ai-toggle"
      >
        {on ? MY_CHATS_TEXT.aiPause : MY_CHATS_TEXT.aiResume}
      </button>
    </span>
  );
}

function ClientChip() {
  return <span className="shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-semibold text-brand-text">{MY_CHATS_TEXT.client}</span>;
}

/**
 * Detalles de un chat privado (o de un cliente que atiende otra persona): sin
 * datos de CRM, que aquí no existen hasta «Es cliente».
 */
function NumberChatDetails({
  chat,
  canMark,
  busy,
  onMark,
  onClose,
}: {
  chat: MyChat;
  canMark: boolean;
  busy: boolean;
  onMark: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 max-xl:bg-popover">
        <h3 className="kicker text-text-2">Detalles</h3>
        <button onClick={onClose} aria-label="Ocultar panel" className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground">
          <ChevronRight className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </header>
      <section className="border-b p-4">
        <div className="flex items-center gap-3">
          <ContactAvatar name={chat.contact.name} seed={chat.contact.id} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight">{chat.contact.name}</p>
            <p className="text-xs text-text-3">{chat.contact.phone ? `+${chat.contact.phone}` : "Sin teléfono"}</p>
          </div>
        </div>
        <p className="mt-3 flex items-start gap-2 rounded-md border bg-subtle px-3 py-2.5 text-[12px] leading-snug text-text-2">
          <Lock className="mt-[1px] h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <span>{chat.clientMarkedAt ? MY_CHATS_TEXT.panelOther : MY_CHATS_TEXT.panelPrivate}</span>
        </p>
        {!chat.clientMarkedAt &&
          (canMark ? (
            <Button size="sm" variant="outline" className="mt-3 w-full" disabled={busy} onClick={onMark} title={MY_CHATS_TEXT.markClientHelp}>
              <UserCheck className="mr-1.5 h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              {MY_CHATS_TEXT.markClient}
            </Button>
          ) : (
            <Link href="/settings/my-number" className="mt-3 block text-[12px] text-text-3 underline-offset-2 hover:underline">
              {MY_CHATS_TEXT.shareOff}
            </Link>
          ))}
      </section>
    </div>
  );
}

function ChatRow({
  chat,
  active,
  onSelect,
  onPatch,
  onRefetch,
  onError,
}: {
  chat: MyChat;
  active: boolean;
  onSelect: () => void;
  onPatch: (id: string, patch: Partial<ConversationDto>) => void;
  onRefetch: () => void;
  onError: (message: string) => void;
}) {
  return (
    <div className={cn("border-b", active ? "bg-brand-tint" : "hover:bg-accent")}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        data-testid="my-number-chat"
        className={cn(
          "flex w-full items-center gap-3 px-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          chat.crm ? "pt-3" : "py-3",
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
      {chat.crm && <RowCapsules conversation={chat.crm} onPatch={onPatch} onRefetch={onRefetch} onError={onError} />}
    </div>
  );
}

/** Etapas, etiquetas y equipo: se piden UNA vez para toda la lista, no por fila. */
const CapsuleCatalogs = createContext<{
  catalogs: ReturnType<typeof useInboxCatalogs>;
  members: ReturnType<typeof useAssignees>;
}>({
  catalogs: { stages: [], tags: [], addTag: () => {} },
  members: [],
});

/** Las cápsulas de etapa, etiquetas y quién atiende, las mismas de la fila de Empresa. */
function RowCapsules({
  conversation,
  onPatch,
  onRefetch,
  onError,
}: {
  conversation: ConversationDto;
  onPatch: (id: string, patch: Partial<ConversationDto>) => void;
  onRefetch: () => void;
  onError: (message: string) => void;
}) {
  const { catalogs, members } = useContext(CapsuleCatalogs);
  const viewer = useViewer();
  return (
    <div className="flex min-w-0 items-center gap-1.5 pb-3 pl-[58px] pr-4 pt-2" data-testid="my-number-capsules">
      <StageCapsule conversation={conversation} stages={catalogs.stages} onPatch={onPatch} onRefetch={onRefetch} onError={onError} />
      <span aria-hidden className="shrink-0 text-[10.5px] text-text-3">
        ·
      </span>
      <TagsCapsule
        conversation={conversation}
        catalog={catalogs.tags}
        canCreate={viewer.can("tags.manage")}
        onCatalogAdd={catalogs.addTag}
        onPatch={onPatch}
        onRefetch={onRefetch}
        onError={onError}
      />
      <span aria-hidden className="shrink-0 text-[10.5px] text-text-3">
        ·
      </span>
      <AssigneeCapsule
        conversation={conversation}
        members={members}
        canAssign={viewer.can("assignment.manage")}
        viewerId={viewer.userId}
        onPatch={onPatch}
        onRefetch={onRefetch}
        onError={onError}
      />
    </div>
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
