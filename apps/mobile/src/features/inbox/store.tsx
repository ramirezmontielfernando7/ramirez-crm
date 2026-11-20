import { ErrorState, Skeleton } from "../../components/ui";
import { teamFor, useTeam } from "../team/state";
import { CatalogStore } from "../catalog/core";
import { preferencesStorage } from "../../services/storage";
import React, {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useSyncExternalStore,
} from "react";
import { useSession } from "../../state/SessionProvider";
import { InboxStore } from "./store-core";
export type { DataState } from "./store-core";
const Context = createContext<InboxStore | null>(null);
export function InboxProvider({ children }: React.PropsWithChildren) {
  const { session } = useSession();
  const { store: roster, state: rosterState } = useTeam();
  const store = useMemo(
    () =>
      session && rosterState.ready
        ? new InboxStore(
            session,
            new CatalogStore(session, "demo-org-cristal", preferencesStorage),
            teamFor(),
          )
        : null,
    [session?.id, session?.role, rosterState.ready],
  );
  useEffect(() => {
    if (store) void store.repository.catalog.hydrate();
  }, [store]);
  if (!rosterState.ready)
    return rosterState.error ? (
      <ErrorState onRetry={() => void roster.reload()} />
    ) : (
      <Skeleton rows={3} />
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

export function useConversation(id: string) {
  const inbox = useInbox();
  const read = useMemo(
    () => () => {
      try {
        return inbox.repository.get(inbox.actor, id);
      } catch {
        return null;
      }
    },
    [inbox, id],
  );
  return useSyncExternalStore(inbox.subscribe, read, read);
}
