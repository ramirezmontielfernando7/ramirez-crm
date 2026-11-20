import { OptOutStore } from "../optout/core";
import { guardedStorage } from "../team/guarded-storage";
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
const idleState = { ready: true, error: "" };
const idleSnapshot = () => idleState;
const idleSubscribe = () => () => {};
const Context = createContext<InboxStore | null>(null);
export function InboxProvider({ children }: React.PropsWithChildren) {
  const { session } = useSession();
  const { store: roster, state: rosterState } = useTeam();
  const store = useMemo(
    () =>
      session && rosterState.ready
        ? new InboxStore(
            session,
            new CatalogStore(
              session,
              "demo-org-cristal",
              guardedStorage(roster, session.id, preferencesStorage),
            ),
            teamFor(),
          )
        : null,
    [session?.id, session?.role, rosterState.ready],
  );
  const policy = useMemo(
    () =>
      store
        ? new OptOutStore(
            roster,
            store.actor.id,
            guardedStorage(roster, store.actor.id, preferencesStorage),
          )
        : null,
    [store, roster],
  );
  const policyState = useSyncExternalStore(
    policy?.subscribe ?? idleSubscribe,
    policy?.snapshot ?? idleSnapshot,
    policy?.snapshot ?? idleSnapshot,
  );
  useEffect(() => {
    if (policy && store)
      void policy.hydrate().then(() => {
        if (policy.snapshot().ready) {
          store.repository.restoreOptOut(
            store.actor,
            policy.snapshot().doc.events.map((e) => e.contact),
          );
          store.reload();
        }
      });
  }, [policy, store]);
  useEffect(() => {
    if (store) void store.repository.catalog.hydrate();
  }, [store]);
  if (!rosterState.ready)
    return rosterState.error ? (
      <ErrorState onRetry={() => void roster.reload()} />
    ) : (
      <Skeleton rows={3} />
    );
  if (policy && !policyState.ready)
    return policyState.error ? (
      <ErrorState
        onRetry={() =>
          void policy.hydrate().then(() => {
            if (policy.snapshot().ready && store) {
              store.repository.restoreOptOut(
                store.actor,
                policy.snapshot().doc.events.map((e) => e.contact),
              );
              store.reload();
            }
          })
        }
      />
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
