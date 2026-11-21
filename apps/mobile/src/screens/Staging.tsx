import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, BackHandler, FlatList, Platform, View } from "react-native";
import { fetch } from "expo/fetch";
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
  StagingAuthRepository,
  StagingHttpError,
  stagingOrigin,
} from "../integration/staging-http";
import type { WireConversation, WireMessage } from "../integration/wire";
import { useTheme } from "../theme/ThemeProvider";
import { LoginForm } from "./Access";

export const stagingSelected = process.env.EXPO_PUBLIC_MODE === "staging";
const stagingModules = ["inbox", "crm", "studio", "marketing", "more"] as const;
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
const keychain = {
  keychainService: "dashfort.staging",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const secureStorage = {
  get: (key: string) => SecureStore.getItemAsync(key, keychain),
  set: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, keychain),
  remove: (key: string) => SecureStore.deleteItemAsync(key, keychain),
};

export function StagingRoot() {
  const [setup] = useState(() => {
    try {
      if (Platform.OS === "web")
        throw new Error("Abre la app móvil para entrar a staging.");
      return {
        repository: new StagingAuthRepository(
          stagingOrigin(process.env.EXPO_PUBLIC_API_URL),
          secureStorage,
          fetch,
        ),
      };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Configuración de staging inválida.",
      };
    }
  });
  return setup.repository ? (
    <StagingSession repository={setup.repository} />
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
  return error instanceof StagingHttpError
    ? error.message
    : "No se pudieron cargar los datos. Reintenta.";
}

function StagingSession({ repository }: { repository: StagingAuthRepository }) {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [notice, setNotice] = useState("");
  const [leaving, setLeaving] = useState(false);
  const logoutBusy = useRef(false);
  useEffect(() => {
    let alive = true;
    void repository
      .restore()
      .then((value) => {
        if (alive) setLoggedIn(!!value);
      })
      .catch(() => {
        if (alive) setNotice("No se pudo abrir el almacenamiento seguro.");
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [repository]);
  const expired = useCallback((error: StagingHttpError) => {
    setLoggedIn(false);
    setNotice(error.message);
  }, []);
  const logout = async () => {
    if (logoutBusy.current) return;
    logoutBusy.current = true;
    setLoggedIn(false);
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
  if (!loggedIn)
    return (
      <LoginForm
        notice={notice}
        onSignIn={async (email, password) => {
          await repository.signIn(email, password);
          setNotice("");
          setLoggedIn(true);
        }}
      />
    );
  return (
    <StagingWorkspace
      repository={repository}
      expired={expired}
      logout={logout}
    />
  );
}

type Reader = ReturnType<typeof createReadOnlyConversationClient>;
function StagingWorkspace({
  repository,
  expired,
  logout,
}: {
  repository: StagingAuthRepository;
  expired: (error: StagingHttpError) => void;
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
              <StagingInbox
                active={showInbox}
                read={read}
                expired={expired}
                open={setChat}
              />
            </View>
            {module === "more" && (
              <PageScroll>
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
            modules={stagingModules}
            selected={module}
            onPress={setModule}
          />
        )}
      </View>
      {chat && (
        <View style={{ position: "absolute", inset: 0 }}>
          <StagingChat
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

function useFailure(expired: (error: StagingHttpError) => void) {
  const [error, setError] = useState("");
  const fail = useCallback(
    (reason: unknown) => {
      if (
        reason instanceof StagingHttpError &&
        (reason.status === 401 || reason.code === "organization_suspended")
      ) {
        expired(reason);
      } else {
        setError(errorMessage(reason));
      }
    },
    [expired],
  );
  return { error, setError, fail };
}

function StagingInbox({
  active,
  read,
  expired,
  open,
}: {
  active: boolean;
  read: Reader;
  expired: (error: StagingHttpError) => void;
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
          if (reason instanceof StagingHttpError && reason.status === 403) {
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

function StagingChat({
  chat,
  read,
  expired,
  back,
}: {
  chat: WireConversation;
  read: Reader;
  expired: (error: StagingHttpError) => void;
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
