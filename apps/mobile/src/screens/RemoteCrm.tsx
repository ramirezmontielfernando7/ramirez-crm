import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, BackHandler, FlatList, Platform, View } from "react-native";
import { fetch } from "expo/fetch";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { AppBar, SegmentedControl } from "../components/ModuleUi";
import { Screen } from "../components/Screen";
import { ModuleTabBar } from "../components/TabBar";
import {
  Banner,
  Button,
  EmptyState,
  ListRow,
  PageScroll,
  Skeleton,
  Text,
} from "../components/ui";
import type { Module } from "../domain/access";
import { createReadOnlyConversationClient } from "../integration/conversation-client";
import {
  RemoteAuthRepository,
  RemoteHttpError,
  requiresRemoteLogin,
  type RemoteMode,
  type RemoteSession,
} from "../integration/remote-http";
import type { WireConversation, WireMessage } from "../integration/wire";
import { useTheme } from "../theme/ThemeProvider";
import { LoginForm } from "./Access";

const remoteModules = ["inbox", "crm", "studio", "marketing", "more"] as const;
const demoModules = {
  crm: "CRM",
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
      await repository.signOut();
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
  const [chat, setChat] = useState<WireConversation | null>(null);
  const showInbox = !chat && module === "inbox" && section === "clients";
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (chat) setChat(null);
      else if (!showInbox) {
        setModule("inbox");
        setSection("clients");
      } else return false;
      return true;
    });
    return () => sub.remove();
  }, [chat, showInbox]);

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        pointerEvents={chat ? "none" : "auto"}
        aria-hidden={!!chat}
        importantForAccessibility={chat ? "no-hide-descendants" : "auto"}
      >
        <Screen>
          <AppBar
            module
            title={
              module === "inbox"
                ? "Bandeja"
                : module === "more"
                  ? "Más"
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
                expired={expired}
                open={setChat}
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
                <Button onPress={() => void logout()}>Cerrar sesión</Button>
              </PageScroll>
            )}
            {((module === "inbox" && section !== "clients") ||
              (module !== "inbox" && module !== "more")) && (
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
        {!chat && (
          <ModuleTabBar
            modules={remoteModules}
            selected={module}
            onPress={setModule}
          />
        )}
      </View>
      {chat && (
        <View style={{ position: "absolute", inset: 0 }}>
          <RemoteChat
            key={chat.id}
            chat={chat}
            read={read}
            expired={expired}
            back={() => setChat(null)}
          />
        </View>
      )}
    </View>
  );
}

function useForeground(active: boolean, refresh: () => void) {
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [active, refresh]);
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
  expired,
  open,
}: {
  active: boolean;
  read: Reader;
  expired: (error: RemoteHttpError) => void;
  open: (row: WireConversation) => void;
}) {
  const [rows, setRows] = useState<WireConversation[]>([]);
  const [busy, setBusy] = useState(true);
  const [more, setMore] = useState(false);
  const cursor = useRef<string | null>(null);
  const revision = useRef(0);
  const loaded = useRef(false);
  const pending = useRef(false);
  const { error, setError, fail } = useFailure(expired);
  const load = useCallback(
    (append = false) => {
      const start = append ? cursor.current : null;
      if (append && (!start || pending.current)) return;
      pending.current = true;
      const request = ++revision.current;
      setBusy(true);
      setError("");
      void read
        .page(start ?? undefined)
        .then((page) => {
          if (revision.current !== request) return;
          const next = page.nextCursor !== start ? page.nextCursor : null;
          loaded.current = true;
          cursor.current = next;
          setMore(!!next);
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
      if (!loaded.current) refresh();
      else setBusy(false);
    }
    return () => {
      revision.current++;
      pending.current = false;
    };
  }, [active, refresh]);
  useForeground(active, refresh);
  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.id}
      refreshing={busy}
      onRefresh={refresh}
      onEndReached={() => {
        if (!busy && more && !error) load(true);
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
          preview={item.preview ?? ""}
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
}: {
  chat: WireConversation;
  read: Reader;
  expired: (error: RemoteHttpError) => void;
  back: () => void;
}) {
  const { colors } = useTheme();
  const [messages, setMessages] = useState<readonly WireMessage[]>([]);
  const [busy, setBusy] = useState(true);
  const revision = useRef(0);
  const { error, setError, fail } = useFailure(expired);
  const refresh = useCallback(() => {
    const request = ++revision.current;
    setBusy(true);
    setError("");
    void read
      .history(chat.id)
      .then((history) => {
        if (revision.current === request) setMessages(history);
      })
      .catch((reason) => {
        if (revision.current === request) {
          setMessages([]);
          fail(reason);
        }
      })
      .finally(() => {
        if (revision.current === request) setBusy(false);
      });
  }, [chat.id, fail, read, setError]);
  useEffect(() => {
    refresh();
    return () => {
      revision.current++;
    };
  }, [refresh]);
  useForeground(true, refresh);

  return (
    <Screen>
      <AppBar title={chat.contact.name} onBack={back} />
      <View style={{ paddingHorizontal: 16 }}>
        <Text kind="meta" style={{ color: colors.text3 }}>
          Solo lectura
        </Text>
        {!!error && <Banner type="warning">{error}</Banner>}
        {!!error && (
          <Button variant="ghost" onPress={refresh}>
            Reintentar
          </Button>
        )}
      </View>
      <FlatList
        data={messages}
        keyExtractor={(message) => message.id}
        refreshing={busy}
        onRefresh={refresh}
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
            <Text>{item.text ?? "Mensaje sin texto"}</Text>
            <Text kind="meta" style={{ color: colors.text3 }}>
              {new Date(item.createdAt).toLocaleString("es-MX", {
                hour: "2-digit",
                minute: "2-digit",
                day: "numeric",
                month: "short",
              })}
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}
