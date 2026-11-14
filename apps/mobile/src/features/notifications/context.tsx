import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState } from "react-native";
import { router, usePathname, useRootNavigationState } from "expo-router";
import { useSession } from "../../state/SessionProvider";
import { useOptionalInbox } from "../inbox/store";
import { useOptionalChatDirectory } from "../chat/context";
import { preferencesStorage } from "../../services/storage";
import { NotificationStore } from "./core";
import { DemoNotificationBackend } from "./adapters/demo";
import { ORG_A, type Identity } from "./model";
import { LocalNotifications } from "./local";
import { localPort } from "./local-port";
import { LocalProvider } from "./LocalContext";
const Context = createContext<NotificationStore | null>(null);
let sessions = 0;
export function NotificationProvider({ children }: React.PropsWithChildren) {
  const { session, ready } = useSession(),
    inbox = useOptionalInbox(),
    chats = useOptionalChatDirectory(),
    path = usePathname(),
    navigationReady = !!useRootNavigationState()?.key;
  const refs = useRef({ session, inbox, chats, path, navigationReady });
  refs.current = { session, inbox, chats, path, navigationReady };
  const [store] = useState(() => {
    const backend = new DemoNotificationBackend();
    return new NotificationStore(backend, preferencesStorage, {
      ready: () => refs.current.navigationReady,
      activeChat: () =>
        refs.current.path.startsWith("/conversation/")
          ? (refs.current.path.split("/").pop() ?? null)
          : null,
      canOpen: (i, id) => {
        try {
          backend.authorize(i, id);
          if (
            i.organizationId !== ORG_A ||
            refs.current.session?.id !== i.userId ||
            !refs.current.inbox
          )
            return false;
          refs.current.inbox.repository.get(refs.current.inbox.actor, id);
          return true;
        } catch {
          return false;
        }
      },
      open: (id) => {
        if (refs.current.path !== `/conversation/${id}`)
          router.push(`/conversation/${id}`);
      },
      apply: async (i, rows, current) => {
        const ref = refs.current;
        if (
          i.organizationId !== ORG_A ||
          ref.session?.id !== i.userId ||
          !ref.inbox ||
          !ref.chats
        )
          return;
        for (const row of rows) {
          const valid = () => {
            try {
              backend.authorize(i, row.id);
              return (
                current() &&
                refs.current.inbox === ref.inbox &&
                refs.current.session?.id === i.userId
              );
            } catch {
              return false;
            }
          };
          if (!valid()) return;
          // Hydrate only the bounded mock conversations changed by the server snapshot.
          const chat = row.messages.length ? ref.chats.get(row.id) : undefined;
          if (chat) {
            await chat.hydrate();
            if (!valid()) return;
            chat.reconcileNotificationMessages(
              row.messages.filter((m) => m.time <= Date.now()),
              valid,
            );
          }
          if (valid())
            ref.inbox.reconcileNotification(
              row.id,
              row.messages.map((m) => m.id),
            );
        }
      },
    });
  });
  const [local] = useState(
    () => new LocalNotifications(store, localPort, preferencesStorage),
  );
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    let live = true;
    void local
      .hydrate()
      .catch(local.failure)
      .then(() => store.hydrate())
      .then(() => {
        if (!live || !ready) return;
        const i: Identity | null = session
          ? {
              userId: session.id,
              organizationId: ORG_A,
              sessionId: `demo-session-${Date.now()}-${++sessions}`,
              expiresAt: session.expiresAt,
            }
          : null;
        store.identity(i);
        setInitialized(true);
        if (i)
          void store
            .sync()
            .then(() => store.openPending())
            .catch(() => {});
      })
      .catch(() => setInitialized(false));
    return () => {
      live = false;
    };
  }, [store, local, session, ready]);
  useEffect(() => {
    if (navigationReady) void store.openPending();
  }, [store, navigationReady]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      void store.foreground(state === "active");
    });
    return () => sub.remove();
  }, [store]);
  return (
    <Context.Provider value={store}>
      <LocalProvider local={local} initialized={initialized}>
        {children}
      </LocalProvider>
    </Context.Provider>
  );
}
export function useNotifications() {
  const store = useContext(Context);
  if (!store) throw Error("Falta el simulador de avisos.");
  return store;
}
export const useNotificationState = (s: NotificationStore) =>
  useSyncExternalStore(s.subscribe, s.snapshot, s.snapshot);
