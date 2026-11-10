import React, {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useSession } from "../../state/SessionProvider";
import { InboxStore } from "./store-core";
export type { DataState } from "./store-core";
const Context = createContext<InboxStore | null>(null);
export function InboxProvider({ children }: React.PropsWithChildren) {
  const { session } = useSession();
  const store = useMemo(
    () => (session ? new InboxStore(session) : null),
    [session?.id],
  );
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useInbox() {
  const store = useContext(Context);
  if (!store) throw new Error("Se requiere sesión demo");
  return store;
}
export function useInboxState() {
  const store = useInbox();
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}

export function useInboxUnread() {
  const store = useContext(Context);
  const snapshot = useMemo(() => {
    let previous: unknown;
    let count = 0;
    return () => {
      const data = store?.snapshot().data ?? [];
      if (data !== previous) {
        previous = data;
        count = data.filter(
          (c) => !c.archived && !c.campaign && c.unread > 0,
        ).length;
      }
      return count;
    };
  }, [store]);
  return useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    snapshot,
    snapshot,
  );
}

export function useOptionalInbox() {
  return useContext(Context);
}
