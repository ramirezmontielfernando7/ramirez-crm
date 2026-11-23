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

import { RemoteAttachmentComposer } from "./RemoteAttachments";
import { RemoteTimeline } from "./RemoteTimeline";
import { AreaChat, AreaList } from "./RemoteInboxAreas";
import {
  connectedOwnNumber,
  ownNumberChats,
  teamThreads,
  type AreaRow,
} from "../integration/remote-inbox-areas";
import {
  chatStyle,
  newestMessages,
  type ChatStyle,
} from "../integration/chat-timeline";
import { clearRemoteMedia } from "./remote-media-cache";

import { RemoteAgents, RemoteChatAI, RemoteWritingAssist } from "./RemoteAi";

import { RemoteResults } from "./RemoteResults";

import { RemoteCampaigns } from "./RemoteCampaigns";

import {
  RemoteSettings,
  remoteModulesAccess,
  type MobileBar,
} from "./RemoteSettings";
import { RemoteFeedback, useRemoteData } from "./RemoteWorkspaceUi";
import { preferencesStorage } from "../services/storage";

import { useRemotePush, type RemotePushControls } from "./useRemotePush";
import type { PushTap } from "../integration/remote-push";

const remoteModules = ["inbox", "crm", "studio", "marketing", "more"] as const;
const allSections = [
  { key: "clients", label: "Clientes" },
  { key: "team", label: "Equipo" },
  { key: "number", label: "Mi número" },
] as const;
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
  const push = useRemotePush(repository, session, expired);
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
        try {
          await push.disconnect();
        } finally {
          await repository.signOut();
        }
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
      pushControls={push.controls}
      pushTap={push.tap}
      clearPushTap={push.clearTap}
    />
  );
}

type Reader = ReturnType<typeof createReadOnlyConversationClient>;
function RemoteWorkspace({
  repository,
  expired,
  logout,
  pushControls,
  pushTap,
  clearPushTap,
}: {
  repository: RemoteAuthRepository;
  expired: (error: RemoteHttpError) => void;
  logout: () => Promise<void>;
  pushControls: RemotePushControls;
  pushTap?: PushTap;
  clearPushTap: (id: string) => void;
}) {
  const read = useMemo(
    () => createReadOnlyConversationClient((path) => repository.read(path)),
    [repository],
  );
  const [module, setModule] = useState<Module>("inbox");
  const [section, setSection] = useState("clients");
  const [areaChat, setAreaChat] = useState<{
    area: "team" | "number";
    row: AreaRow;
  }>();
  const readTeamArea = useCallback(async () => {
    try {
      return teamThreads(await repository.read("/api/team-chat/threads"));
    } catch (reason) {
      if (
        reason instanceof RemoteHttpError &&
        !requiresRemoteLogin(reason) &&
        [403, 404].includes(reason.status)
      )
        return null;
      throw reason;
    }
  }, [repository]);
  const readNumberArea = useCallback(async () => {
    try {
      const number = connectedOwnNumber(
        await repository.read("/api/settings/my-number"),
      );
      return number
        ? ownNumberChats(await repository.read("/api/my-number/chats"), number)
        : null;
    } catch (reason) {
      if (
        reason instanceof RemoteHttpError &&
        !requiresRemoteLogin(reason) &&
        [403, 404].includes(reason.status)
      )
        return null;
      throw reason;
    }
  }, [repository]);
  const teamArea = useRemoteData(readTeamArea, expired);
  const numberArea = useRemoteData(readNumberArea, expired);
  const teamVisible = Array.isArray(teamArea.data);
  const numberVisible = Array.isArray(numberArea.data);
  const sections = useMemo(
    () =>
      allSections.filter(
        ({ key }) =>
          key === "clients" || (key === "team" ? teamVisible : numberVisible),
      ),
    [teamVisible, numberVisible],
  );
  const refreshTeam = teamArea.refresh;
  const refreshNumber = numberArea.refresh;
  useEffect(() => {
    if (
      (section === "team" && !teamVisible) ||
      (section === "number" && !numberVisible)
    ) {
      setAreaChat(undefined);
      setSection("clients");
    }
  }, [section, teamVisible, numberVisible]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void refreshTeam();
        void refreshNumber();
      }
    });
    return () => sub.remove();
  }, [refreshTeam, refreshNumber]);
  const invalidateArea = useCallback(() => {
    if (section === "team") void refreshTeam();
    if (section === "number") void refreshNumber();
  }, [section, refreshTeam, refreshNumber]);
  const [page, setPage] = useState<
    "contact" | "tasks" | "agenda" | "schedule" | "results" | "settings" | null
  >(null);
  const loadAccess = useCallback(
    () => remoteModulesAccess(repository),
    [repository],
  );
  const available = useRemoteData(loadAccess, expired);
  const capabilities = available.data;
  const [bar, setBar] = useState<MobileBar>("standard");
  const barKey = `dashfort.${repository.mode}.mobile-bar.v1`;
  useEffect(() => {
    let active = true;
    void preferencesStorage
      .get(barKey)
      .then((value) => {
        if (active && value === "crm-first") setBar(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [barKey]);
  async function updateBar(next: MobileBar) {
    if (next !== "standard" && next !== "crm-first") return;
    await preferencesStorage.set(barKey, next);
    setBar(next);
  }
  const tabs = remoteModules.filter(
    (item) =>
      (item !== "studio" || capabilities?.agents || module === "studio") &&
      (item !== "marketing" ||
        capabilities?.campaigns ||
        module === "marketing"),
  );
  if (bar === "crm-first") {
    const first = tabs[0],
      second = tabs[1];
    if (first === "inbox" && second === "crm") {
      tabs[0] = second;
      tabs[1] = first;
    }
  }
  const [appearance, setAppearance] = useState<ChatStyle>("whatsapp");
  const appearanceKey = "dashfort.chat-style.v1";
  useEffect(() => {
    let live = true;
    void preferencesStorage
      .get(appearanceKey)
      .then((value) => {
        if (live) setAppearance(chatStyle(value));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  async function updateAppearance(next: ChatStyle) {
    await preferencesStorage.set(appearanceKey, next);
    setAppearance(next);
  }
  const [chat, setChat] = useState<WireConversation | null>(null);
  const onChatSnapshot = useCallback((row: WireConversation) => {
    setChat((current) => (current?.id === row.id ? row : current));
  }, []);
  const [readReceipt, setReadReceipt] = useState<{ id: string }>();
  const onRead = useCallback((id: string) => setReadReceipt({ id }), []);
  const [pushError, setPushError] = useState("");
  useEffect(() => {
    if (!pushTap) return;
    let active = true;
    void read
      .byId(pushTap.conversationId)
      .then((row) => {
        if (!active) return;
        clearPushTap(pushTap.id);
        setPage(null);
        setAreaChat(undefined);
        setModule("inbox");
        setSection("clients");
        setPushError(row ? "" : "Este chat ya no está disponible.");
        setChat(row ?? null);
      })
      .catch((reason) => {
        if (!active) return;
        clearPushTap(pushTap.id);
        if (requiresRemoteLogin(reason)) expired(reason);
        else setPushError("No se pudo abrir el chat del aviso.");
      });
    return () => {
      active = false;
    };
  }, [pushTap, read, clearPushTap, expired]);
  const overlay = Boolean(chat || areaChat || page);
  const showInbox = !overlay && module === "inbox" && section === "clients";
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (page === "schedule") setPage("contact");
      else if (page) setPage(null);
      else if (chat) setChat(null);
      else if (areaChat) setAreaChat(undefined);
      else if (!showInbox) {
        setModule("inbox");
        setSection("clients");
      } else return false;
      return true;
    });
    return () => sub.remove();
  }, [areaChat, chat, page, showInbox]);

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
              {
                inbox: "Bandeja",
                more: "Más",
                crm: "Pipeline",
                studio: "Estudio IA",
                marketing: "Marketing",
              }[module]
            }
          />
          {!!pushError && !overlay && (
            <Banner type="warning">{pushError}</Banner>
          )}
          {module === "inbox" &&
            !overlay &&
            (teamArea.error || numberArea.error) && (
              <View style={{ paddingHorizontal: 16 }}>
                <RemoteFeedback
                  error={teamArea.error || numberArea.error}
                  pending={false}
                  refresh={async () => {
                    await Promise.all([
                      teamArea.error ? refreshTeam() : undefined,
                      numberArea.error ? refreshNumber() : undefined,
                    ]);
                  }}
                />
              </View>
            )}
          {module === "inbox" && sections.length > 1 && (
            <View
              style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}
            >
              <SegmentedControl
                fixedGeometry
                value={section}
                options={sections}
                onChange={(next) => {
                  setSection(next);
                  if (next === "team") void refreshTeam();
                  if (next === "number") void refreshNumber();
                }}
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
                <RemoteFeedback {...available} />
                {capabilities?.tasks && (
                  <Button variant="secondary" onPress={() => setPage("tasks")}>
                    Tareas
                  </Button>
                )}
                {capabilities?.agenda && (
                  <Button variant="secondary" onPress={() => setPage("agenda")}>
                    Agenda
                  </Button>
                )}
                {capabilities?.results && (
                  <Button
                    variant="secondary"
                    onPress={() => setPage("results")}
                  >
                    Resultados
                  </Button>
                )}
                <Button variant="secondary" onPress={() => setPage("settings")}>
                  Ajustes
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
            {module === "marketing" && (
              <PageScroll style={{ paddingBottom: 112 }}>
                <RemoteCampaigns repository={repository} expired={expired} />
              </PageScroll>
            )}
            {module === "inbox" && section === "team" && teamVisible && (
              <AreaList
                key="team"
                rows={teamArea.data ?? []}
                error={teamArea.error}
                pending={teamArea.pending}
                refresh={refreshTeam}
                select={(row) => setAreaChat({ area: "team", row })}
              />
            )}
            {module === "inbox" && section === "number" && numberVisible && (
              <AreaList
                key="number"
                rows={numberArea.data ?? []}
                error={numberArea.error}
                pending={numberArea.pending}
                refresh={refreshNumber}
                select={(row) => setAreaChat({ area: "number", row })}
              />
            )}
          </View>
        </Screen>
        {!overlay && (
          <ModuleTabBar modules={tabs} selected={module} onPress={setModule} />
        )}
      </View>
      {areaChat && (
        <View style={{ position: "absolute", inset: 0 }}>
          <AreaChat
            key={areaChat.area + ":" + areaChat.row.id}
            {...areaChat}
            appearance={appearance}
            repository={repository}
            expired={expired}
            back={() => {
              setAreaChat(undefined);
              invalidateArea();
            }}
            lost={invalidateArea}
          />
        </View>
      )}
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
            appearance={appearance}
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
          {page === "settings" && (
            <RemoteSettings
              repository={repository}
              expired={expired}
              back={() => setPage(null)}
              bar={bar}
              setBar={updateBar}
              appearance={appearance}
              setAppearance={updateAppearance}
              logout={logout}
              team={capabilities?.team === true}
              push={pushControls}
            />
          )}
          {page === "results" && (
            <RemoteResults
              team={capabilities?.teamResults === true}
              repository={repository}
              expired={expired}
              back={() => setPage(null)}
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
  appearance,
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
  appearance: ChatStyle;
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
        setMessages((prior) => newestMessages(prior, history));
        return true;
      } catch (reason) {
        if (revision.current === request) {
          if (
            reason instanceof RemoteHttpError &&
            [403, 404].includes(reason.status)
          )
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
      <RemoteTimeline
        messages={messages}
        busy={busy}
        refresh={() => void refresh()}
        appearance={appearance}
        repository={repository}
        expired={expired}
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
