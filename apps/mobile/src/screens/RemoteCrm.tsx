import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppState,
  BackHandler,
  FlatList,
  Keyboard,
  Platform,
  View,
} from "react-native";
import { fetch } from "expo/fetch";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { UserRound } from "lucide-react-native";
import { AppBar, IconButton, SegmentedControl } from "../components/ModuleUi";
import { Screen } from "../components/Screen";
import { ModuleTabBar } from "../components/TabBar";
import {
  Banner,
  Button,
  EmptyState,
  Field,
  ListRow,
  PageScroll,
  Skeleton,
  Text,
} from "../components/ui";
import type { Module } from "../domain/access";
import { createReadOnlyConversationClient } from "../integration/conversation-client";
import {
  RemoteAuthRepository,
  REMOTE_TEXT_MAX,
  remoteSendEnabled,
  RemoteHttpError,
  requiresRemoteLogin,
  type RemoteMode,
  type RemoteSession,
} from "../integration/remote-http";
import type { WireConversation, WireMessage } from "../integration/wire";
import { useTheme } from "../theme/ThemeProvider";
import { LoginForm } from "./Access";
import { useLayers } from "../components/Layers";
import {
  canSendTemplates,
  insertQuickReply,
} from "../integration/remote-composer";
import { RemoteQuickReplies, RemoteTemplates } from "./RemoteComposerOptions";
import { useRemoteLive } from "./useRemoteLive";
import {
  BookingSlots,
  RemoteAgenda,
  RemoteContact,
  RemoteTasks,
} from "./RemoteRelations";

import { RemotePipeline } from "./RemotePipeline";

import {
  RemoteAttachmentComposer,
  RemoteAttachmentRow,
} from "./RemoteAttachments";
import { clearRemoteMedia } from "./remote-media-cache";

import { RemoteAgents, RemoteChatAI, RemoteWritingAssist } from "./RemoteAi";

const remoteModules = ["inbox", "crm", "studio", "marketing", "more"] as const;
const demoModules = {
  crm: "Pipeline",
  studio: "Estudio IA",
  marketing: "Marketing",
};
const sections = [
  { key: "clients", label: "Clientes" },
  { key: "team", label: "Equipo" },
  { key: "number", label: "Mi número" },
];
function deviceStorage(mode: RemoteMode) {
  const keychain = {
    keychainService: `dashfort.${mode}`,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  return {
    get: (key: string) => SecureStore.getItemAsync(key, keychain),
    set: (key: string, value: string) =>
      SecureStore.setItemAsync(key, value, keychain),
    remove: (key: string) => SecureStore.deleteItemAsync(key, keychain),
  };
}

export function RemoteRoot({ mode }: { mode: RemoteMode | "invalid" }) {
  const [setup] = useState(() => {
    try {
      if (mode === "invalid")
        throw new Error(
          "EXPO_PUBLIC_MODE debe ser demo, staging o production.",
        );
      const repository = new RemoteAuthRepository(
        mode,
        process.env.EXPO_PUBLIC_API_URL,
        deviceStorage(mode),
        fetch,
        Date.now,
        remoteSendEnabled(process.env.EXPO_PUBLIC_ALLOW_SEND),
      );
      if (Platform.OS === "web")
        throw new Error("Abre la app móvil para conectarte a Dashfort.");
      return { repository };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Configuración de conexión inválida.",
      };
    }
  });
  return setup.repository ? (
    <RemoteSessionScreen repository={setup.repository} />
  ) : (
    <Screen>
      <AppBar title="Dashfort" />
      <PageScroll>
        <Banner type="danger">{setup.error}</Banner>
      </PageScroll>
    </Screen>
  );
}

function errorMessage(error: unknown) {
  return error instanceof RemoteHttpError
    ? error.message
    : "No se pudieron cargar los datos. Reintenta.";
}

function RemoteSessionScreen({
  repository,
}: {
  repository: RemoteAuthRepository;
}) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [notice, setNotice] = useState("");
  const [leaving, setLeaving] = useState(false);
  const logoutBusy = useRef(false);
  useEffect(() => {
    let alive = true;
    try {
      clearRemoteMedia();
    } catch {
      setNotice("No se pudo limpiar la caché privada.");
    }
    void repository
      .restore()
      .then((value) => {
        if (alive) setSession(value);
      })
      .catch((error) => {
        if (alive)
          setNotice(
            requiresRemoteLogin(error)
              ? error.message
              : "No se pudo abrir el almacenamiento seguro.",
          );
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [repository]);
  const expired = useCallback((error: RemoteHttpError) => {
    setSession(null);
    try {
      clearRemoteMedia();
    } catch {
      /* Retry on the next start or sign-in. */
    }
    setNotice(error.message);
  }, []);
  useEffect(() => {
    if (!session) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const remaining = session.expiresAt - Date.now();
      if (remaining > 0) {
        timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
      } else {
        void repository.expireIfNeeded().then((didExpire) => {
          if (active && didExpire)
            expired(new RemoteHttpError(401, "SESSION_EXPIRED"));
        });
      }
    };
    check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      active = false;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [expired, repository, session]);

  const logout = async () => {
    if (logoutBusy.current) return;
    logoutBusy.current = true;
    setSession(null);
    setLeaving(true);
    setNotice("");
    try {
      try {
        clearRemoteMedia();
      } finally {
        await repository.signOut();
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "No se pudo confirmar el cierre.",
      );
    } finally {
      setLeaving(false);
      logoutBusy.current = false;
    }
  };
  if (!ready || leaving)
    return (
      <Screen>
        <Skeleton rows={4} />
      </Screen>
    );
  if (!session)
    return (
      <LoginForm
        notice={notice}
        onSignIn={async (email, password) => {
          try {
            clearRemoteMedia();
          } catch {
            throw new Error("No se pudo limpiar la caché privada.");
          }
          const signedIn = await repository.signIn(email, password);
          setNotice("");
          setSession(signedIn);
        }}
      />
    );
  return (
    <RemoteWorkspace
      repository={repository}
      expired={expired}
      logout={logout}
    />
  );
}

type Reader = ReturnType<typeof createReadOnlyConversationClient>;
function RemoteWorkspace({
  repository,
  expired,
  logout,
}: {
  repository: RemoteAuthRepository;
  expired: (error: RemoteHttpError) => void;
  logout: () => Promise<void>;
}) {
  const read = useMemo(
    () => createReadOnlyConversationClient((path) => repository.read(path)),
    [repository],
  );
  const [module, setModule] = useState<Module>("inbox");
  const [section, setSection] = useState("clients");
  const [page, setPage] = useState<
    "contact" | "tasks" | "agenda" | "schedule" | null
  >(null);
  const [chat, setChat] = useState<WireConversation | null>(null);
  const onChatSnapshot = useCallback((row: WireConversation) => {
    setChat((current) => (current?.id === row.id ? row : current));
  }, []);
  const [readReceipt, setReadReceipt] = useState<{ id: string }>();
  const onRead = useCallback((id: string) => setReadReceipt({ id }), []);
  const overlay = Boolean(chat || page);
  const showInbox = !overlay && module === "inbox" && section === "clients";
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (page === "schedule") setPage("contact");
      else if (page) setPage(null);
      else if (chat) setChat(null);
      else if (!showInbox) {
        setModule("inbox");
        setSection("clients");
      } else return false;
      return true;
    });
    return () => sub.remove();
  }, [chat, page, showInbox]);

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        pointerEvents={overlay ? "none" : "auto"}
        aria-hidden={overlay}
        importantForAccessibility={overlay ? "no-hide-descendants" : "auto"}
      >
        <Screen>
          <AppBar
            module
            title={
              module === "inbox"
                ? "Bandeja"
                : module === "more"
                  ? "Más"
                  : module === "crm"
                    ? "Pipeline"
                    : module === "studio"
                      ? "Estudio IA"
                      : `${demoModules[module]} · Demo`
            }
          />
          {module === "inbox" && (
            <View
              style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}
            >
              <SegmentedControl
                fixedGeometry
                value={section}
                options={sections}
                onChange={setSection}
              />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <View
              aria-hidden={!showInbox}
              importantForAccessibility={
                showInbox ? "auto" : "no-hide-descendants"
              }
              pointerEvents={showInbox ? "auto" : "none"}
              style={{
                position: "absolute",
                inset: 0,
                opacity: showInbox ? 1 : 0,
              }}
            >
              <RemoteInbox
                active={showInbox}
                read={read}
                repository={repository}
                expired={expired}
                open={setChat}
                readReceipt={readReceipt}
              />
            </View>
            {module === "more" && (
              <PageScroll>
                <Text kind="meta">
                  {Constants.expoConfig?.version} ·{" "}
                  {repository.mode === "production"
                    ? "Conectado a Dashfort"
                    : "Entorno de pruebas"}
                </Text>
                <Button variant="secondary" onPress={() => setPage("tasks")}>
                  Tareas
                </Button>
                <Button variant="secondary" onPress={() => setPage("agenda")}>
                  Agenda
                </Button>
                <Button onPress={() => void logout()}>Cerrar sesión</Button>
              </PageScroll>
            )}
            {module === "crm" && (
              <PageScroll style={{ paddingBottom: 112 }}>
                <RemotePipeline
                  repository={repository}
                  expired={expired}
                  openChat={async (id) => {
                    const row = await read.byId(id);
                    if (!row) throw new RemoteHttpError(404);
                    setChat(row);
                  }}
                />
              </PageScroll>
            )}
            {module === "studio" && (
              <PageScroll style={{ paddingBottom: 112 }}>
                <RemoteAgents repository={repository} expired={expired} />
              </PageScroll>
            )}
            {((module === "inbox" && section !== "clients") ||
              (module !== "inbox" &&
                module !== "more" &&
                module !== "crm")) && (
              <PageScroll>
                <Banner>
                  {module === "inbox"
                    ? section === "team"
                      ? "Equipo · Demo"
                      : "Mi número · Demo"
                    : "Disponible en modo demo."}
                </Banner>
              </PageScroll>
            )}
          </View>
        </Screen>
        {!overlay && (
          <ModuleTabBar
            modules={remoteModules}
            selected={module}
            onPress={setModule}
          />
        )}
      </View>
      {chat && (
        <View
          style={{ position: "absolute", inset: 0 }}
          pointerEvents={page ? "none" : "auto"}
          aria-hidden={!!page}
          importantForAccessibility={page ? "no-hide-descendants" : "auto"}
        >
          <RemoteChat
            key={chat.id}
            chat={chat}
            read={read}
            repository={repository}
            onRead={onRead}
            onSnapshot={onChatSnapshot}
            active={!page}
            openContact={() => {
              Keyboard.dismiss();
              setPage("contact");
            }}
            expired={expired}
            back={() => setChat(null)}
          />
        </View>
      )}
      {page && (
        <View style={{ position: "absolute", inset: 0 }}>
          {page === "contact" && chat && (
            <RemoteContact
              repository={repository}
              expired={expired}
              chat={chat}
              back={() => setPage(null)}
              createBooking={() => setPage("schedule")}
            />
          )}
          {page === "schedule" && chat && (
            <BookingSlots
              repository={repository}
              expired={expired}
              title="Agendar cita"
              back={() => setPage("contact")}
              save={(time) => repository.addBooking(chat.contact.id, time)}
            />
          )}
          {page === "tasks" && (
            <RemoteTasks
              repository={repository}
              expired={expired}
              back={() => setPage(null)}
            />
          )}
          {page === "agenda" && (
            <RemoteAgenda
              repository={repository}
              expired={expired}
              back={() => setPage(null)}
            />
          )}
        </View>
      )}
    </View>
  );
}

function useFailure(expired: (error: RemoteHttpError) => void) {
  const [error, setError] = useState("");
  const fail = useCallback(
    (reason: unknown) => {
      if (requiresRemoteLogin(reason)) {
        expired(reason);
      } else {
        setError(errorMessage(reason));
      }
    },
    [expired],
  );
  return { error, setError, fail };
}

function RemoteInbox({
  active,
  read,
  repository,
  expired,
  open,
  readReceipt,
}: {
  active: boolean;
  read: Reader;
  repository: RemoteAuthRepository;
  expired: (error: RemoteHttpError) => void;
  open: (row: WireConversation) => void;
  readReceipt?: { id: string };
}) {
  const [rows, setRows] = useState<WireConversation[]>([]);
  useEffect(() => {
    if (!readReceipt) return;
    setRows((current) =>
      current.map((row) =>
        row.id === readReceipt.id ? { ...row, unreadCount: 0 } : row,
      ),
    );
  }, [readReceipt]);
  const [busy, setBusy] = useState(true);
  const [more, setMore] = useState(false);
  const cursor = useRef<string | null>(null);
  const revision = useRef(0);
  const loaded = useRef(false);
  const loadedLength = useRef(0);
  const pending = useRef(false);
  const { error, setError, fail } = useFailure(expired);
  const load = useCallback(
    (append = false, silent = false) => {
      const start = append ? cursor.current : null;
      if ((append && !start) || pending.current) return;
      pending.current = true;
      const request = ++revision.current;
      if (!silent) setBusy(true);
      setError("");
      return read
        .page(
          start ?? undefined,
          silent && !append
            ? Math.max(40, Math.min(500, loadedLength.current))
            : 40,
        )
        .then((page) => {
          if (revision.current !== request) return;
          const next = page.nextCursor !== start ? page.nextCursor : null;
          loaded.current = true;
          cursor.current = next;
          setMore(!!next);
          loadedLength.current =
            (append ? loadedLength.current : 0) + page.conversations.length;
          setRows((old) => [
            ...new Map(
              (append
                ? [...old, ...page.conversations]
                : page.conversations
              ).map((row) => [row.id, row]),
            ).values(),
          ]);
        })
        .catch((reason) => {
          if (revision.current !== request) return;
          if (reason instanceof RemoteHttpError && reason.status === 403) {
            cursor.current = null;
            setMore(false);
            setRows([]);
          }
          fail(reason);
        })
        .finally(() => {
          if (revision.current === request) {
            pending.current = false;
            setBusy(false);
          }
        });
    },
    [fail, read, setError],
  );
  const refresh = useCallback(() => load(), [load]);
  useEffect(() => {
    if (active) {
      if (AppState.currentState === "active" || AppState.currentState === null)
        void load(false, loaded.current);
    }
    return () => {
      revision.current++;
      pending.current = false;
    };
  }, [active, load]);
  const update = useCallback(() => load(false, true), [load]);
  useRemoteLive(active, repository, update, expired);
  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.id}
      refreshing={busy}
      onRefresh={refresh}
      onEndReached={() => {
        if (
          active &&
          AppState.currentState === "active" &&
          !busy &&
          more &&
          !error
        )
          load(true);
      }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: 16,
        paddingBottom: 112,
      }}
      ListHeaderComponent={
        error ? <Banner type="warning">{error}</Banner> : undefined
      }
      ListEmptyComponent={
        busy ? (
          <Skeleton rows={4} />
        ) : !error ? (
          <EmptyState title="Sin conversaciones" />
        ) : undefined
      }
      ListFooterComponent={
        error ? (
          <Button variant="ghost" onPress={refresh}>
            Reintentar
          </Button>
        ) : more ? (
          <Button variant="ghost" loading={busy} onPress={() => load(true)}>
            Cargar más
          </Button>
        ) : undefined
      }
      renderItem={({ item }) => (
        <ListRow
          name={item.contact.name}
          preview={[item.preview, item.assignee?.name]
            .filter(Boolean)
            .join(" · ")}
          unread={item.unreadCount}
          onPress={() => open(item)}
        />
      )}
    />
  );
}

function RemoteChat({
  chat,
  read,
  expired,
  back,
  repository,
  onRead,
  onSnapshot,
  active,
  openContact,
}: {
  active: boolean;
  openContact: () => void;
  chat: WireConversation;
  read: Reader;
  expired: (error: RemoteHttpError) => void;
  back: () => void;
  repository: RemoteAuthRepository;
  onRead: (id: string) => void;
  onSnapshot: (row: WireConversation) => void;
}) {
  const { colors } = useTheme();
  const [messages, setMessages] = useState<readonly WireMessage[]>([]);
  const [busy, setBusy] = useState(true);
  const revision = useRef(0);
  const { error, setError, fail } = useFailure(expired);
  const [readError, setReadError] = useState("");
  const mounted = useRef(false);
  const refresh = useCallback(
    async (silent = false) => {
      const request = ++revision.current;
      if (!silent) setBusy(true);
      setError("");
      try {
        const history = await read.history(chat.id);
        if (revision.current !== request) return false;
        setMessages(history);
        return true;
      } catch (reason) {
        if (revision.current === request) {
          setMessages([]);
          fail(reason);
        }
        return false;
      } finally {
        if (revision.current === request) setBusy(false);
      }
    },
    [chat.id, fail, read, setError],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current++;
    };
  }, []);
  useEffect(() => {
    if (
      active &&
      (AppState.currentState === "active" || AppState.currentState === null)
    )
      void refresh();
  }, [active, refresh]);
  const update = useCallback(
    async (signal?: AbortSignal) => {
      const result = await refresh(true);
      if (!result || !mounted.current || signal?.aborted) return false;
      try {
        const row = await read.byId(chat.id);
        if (row && mounted.current && !signal?.aborted) onSnapshot(row);
        return Boolean(row);
      } catch (reason) {
        if (mounted.current && requiresRemoteLogin(reason)) expired(reason);
        return false;
      }
    },
    [chat.id, expired, onSnapshot, read, refresh],
  );
  useRemoteLive(active, repository, update, expired, {
    conversationId: chat.id,
    contactId: chat.contact.id,
  });

  const mark = useCallback(async () => {
    if (!repository.allowSend) return;
    setReadError("");
    try {
      await repository.markRead(chat.id);
      if (mounted.current) onRead(chat.id);
    } catch (reason) {
      if (!mounted.current) return;
      if (requiresRemoteLogin(reason)) expired(reason);
      else
        setReadError(`No se pudo marcar como leído. ${errorMessage(reason)}`);
    }
  }, [chat.id, expired, onRead, repository]);
  useEffect(() => {
    void mark();
  }, [mark]);

  return (
    <Screen>
      <AppBar
        title={chat.contact.name}
        onBack={back}
        actions={
          <IconButton
            icon={UserRound}
            label="Ficha del contacto"
            onPress={openContact}
          />
        }
      />
      <View style={{ paddingHorizontal: 16 }}>
        <Text kind="meta" style={{ color: colors.text3 }}>
          {repository.allowSend
            ? "Texto, plantillas y adjuntos"
            : "Solo lectura"}
        </Text>
        {!!chat.assignee?.name && (
          <Text kind="meta">Responsable: {chat.assignee.name}</Text>
        )}
        {!!readError && <Banner type="warning">{readError}</Banner>}
        {!!readError && (
          <Button variant="ghost" onPress={() => void mark()}>
            Reintentar leído
          </Button>
        )}
        {!!error && <Banner type="warning">{error}</Banner>}
        {!!error && (
          <Button variant="ghost" onPress={() => void refresh()}>
            Reintentar
          </Button>
        )}
      </View>
      <FlatList
        data={messages}
        keyExtractor={(message) => message.id}
        refreshing={busy}
        onRefresh={() => void refresh()}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 8,
        }}
        ListEmptyComponent={
          busy ? (
            <Skeleton rows={3} />
          ) : !error ? (
            <EmptyState title="Sin mensajes" />
          ) : undefined
        }
        renderItem={({ item }) => (
          <View
            style={{
              alignSelf: item.direction === "out" ? "flex-end" : "flex-start",
              maxWidth: "86%",
              borderRadius: 16,
              padding: 10,
              backgroundColor:
                item.direction === "out" ? colors.wash : colors.sunken,
            }}
          >
            {item.text ? (
              <Text>{item.text}</Text>
            ) : (
              !item.attachment && <Text>Mensaje sin texto</Text>
            )}
            {item.attachment && (
              <RemoteAttachmentRow
                item={item.attachment}
                repository={repository}
                expired={expired}
              />
            )}
            <Text kind="meta" style={{ color: colors.text3 }}>
              {new Date(item.createdAt).toLocaleString("es-MX", {
                hour: "2-digit",
                minute: "2-digit",
                day: "numeric",
                month: "short",
              })}
              {item.direction === "out"
                ? ` · ${messageStatus[item.status]}`
                : ""}
            </Text>
          </View>
        )}
      />
      <RemoteTextComposer
        repository={repository}
        chat={chat}
        expired={expired}
        refresh={refresh}
        refreshChat={() => update()}
      />
    </Screen>
  );
}

const messageStatus: Record<WireMessage["status"], string> = {
  pending: "Pendiente",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Falló",
};

function RemoteTextComposer({
  repository,
  chat,
  expired,
  refresh,
  refreshChat,
}: {
  repository: RemoteAuthRepository;
  chat: WireConversation;
  refreshChat: () => Promise<boolean>;
  expired: (error: RemoteHttpError) => void;
  refresh: () => Promise<boolean>;
}) {
  const { colors } = useTheme();
  const { open, close } = useLayers();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState<{
    message: string;
    uncertain: boolean;
    windowClosed?: boolean;
  }>();
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      close();
    };
  }, [close]);

  function openTemplates() {
    Keyboard.dismiss();
    open({
      kind: "sheet",
      title: "Plantillas aprobadas",
      content: (
        <RemoteTemplates
          repository={repository}
          chat={chat}
          expired={expired}
          refresh={refresh}
        />
      ),
    });
  }

  function openAttachments() {
    Keyboard.dismiss();
    open({
      kind: "sheet",
      title: "Adjuntar archivo",
      content: (
        <RemoteAttachmentComposer
          repository={repository}
          expired={expired}
          id={chat.id}
          refresh={refresh}
          offerTemplates={openTemplates}
        />
      ),
    });
  }

  function openAI() {
    Keyboard.dismiss();
    open({
      kind: "sheet",
      title: "IA en este chat",
      content: (
        <RemoteChatAI
          repository={repository}
          expired={expired}
          chat={chat}
          refresh={refreshChat}
        />
      ),
    });
  }

  function openWriting() {
    Keyboard.dismiss();
    open({
      kind: "sheet",
      title: "Asistente de redacción",
      content: (
        <RemoteWritingAssist
          repository={repository}
          expired={expired}
          draft={draft}
          apply={setDraft}
        />
      ),
    });
  }

  function openReplies() {
    Keyboard.dismiss();
    open({
      kind: "sheet",
      title: "Respuestas rápidas",
      content: (
        <RemoteQuickReplies
          repository={repository}
          expired={expired}
          insert={
            repository.allowSend
              ? (body) =>
                  setDraft((old) =>
                    insertQuickReply(
                      body,
                      chat.contact.name,
                      old,
                      REMOTE_TEXT_MAX,
                    ),
                  )
              : undefined
          }
        />
      ),
    });
  }

  async function send() {
    if (lock.current || !draft.trim() || failure?.uncertain) return;
    lock.current = true;
    setPending(true);
    setNotice("");
    setFailure(undefined);
    try {
      const result = await repository.sendText(chat.id, draft);
      if (!mounted.current || !result) return;
      setDraft("");
      setNotice(result.queued ? "Mensaje en cola." : "Mensaje enviado.");
      await refresh();
    } catch (reason) {
      if (!mounted.current) return;
      if (requiresRemoteLogin(reason)) expired(reason);
      else {
        const uncertain =
          !(reason instanceof RemoteHttpError) ||
          reason.status === 0 ||
          reason.status >= 500;
        setFailure({
          uncertain,
          windowClosed:
            reason instanceof RemoteHttpError &&
            reason.status === 409 &&
            reason.code === "window_closed",
          message: uncertain
            ? `${errorMessage(reason)} El envío no se pudo confirmar. Revisa el historial antes de enviarlo de nuevo.`
            : errorMessage(reason),
        });
      }
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function retry() {
    if (!failure?.uncertain) {
      await send();
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      if ((await refresh()) && mounted.current) {
        setFailure(undefined);
        setNotice(
          "Historial actualizado. Si el mensaje no aparece, revisa el borrador y pulsa Enviar.",
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <View
      style={{
        padding: 12,
        gap: 6,
        borderTopWidth: 1,
        borderColor: colors.border,
      }}
    >
      {notice ? (
        <Text kind="meta" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      {failure && (
        <>
          <Banner type="warning">{failure.message}</Banner>
          {failure.windowClosed && canSendTemplates(chat) ? (
            <Button disabled={pending} onPress={openTemplates}>
              Enviar plantilla
            </Button>
          ) : (
            <Button
              variant="ghost"
              loading={pending}
              onPress={() => void retry()}
            >
              Reintentar
            </Button>
          )}
        </>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {repository.allowSend && Platform.OS !== "web" && (
          <Button variant="ghost" disabled={pending} onPress={openAttachments}>
            Adjuntar
          </Button>
        )}
        {chat.aiAvailable && (
          <Button variant="ghost" disabled={pending} onPress={openAI}>
            IA del chat
          </Button>
        )}
        {repository.allowSend &&
          !!draft.trim() &&
          draft.trim().length <= 4000 && (
            <Button
              variant="ghost"
              disabled={pending || failure?.uncertain}
              onPress={openWriting}
            >
              Mejorar borrador
            </Button>
          )}
        {!(failure?.windowClosed && canSendTemplates(chat)) && (
          <Button variant="ghost" disabled={pending} onPress={openTemplates}>
            Plantillas
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={pending || failure?.uncertain}
          onPress={openReplies}
        >
          Respuestas rápidas
        </Button>
      </View>
      {repository.allowSend && (
        <>
          <Field
            label="Mensaje"
            placeholder="Escribe un mensaje"
            multiline
            maxLength={REMOTE_TEXT_MAX}
            value={draft}
            onChangeText={setDraft}
            editable={!pending}
            style={{ maxHeight: 104 }}
          />
          <Button
            loading={pending}
            disabled={!draft.trim() || failure?.uncertain}
            onPress={() => void send()}
          >
            {pending ? "Enviando…" : "Enviar"}
          </Button>
        </>
      )}
    </View>
  );
}
