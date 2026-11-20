import { channelsFor } from "../channels/registry";
import { ErrorState, Skeleton } from "../../components/ui";
import { storageFor } from "../team/storage";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { preferencesStorage } from "../../services/storage";
import { useOptionalInbox } from "../inbox/store";
import { ContactDirectory, type ContactStore } from "./core";
const idleState = { ready: true, error: "" };
const idleSnapshot = () => idleState;
const idleSubscribe = () => () => {};
const Context = createContext<ContactDirectory | null>(null);
export function ContactProvider({ children }: React.PropsWithChildren) {
  const inbox = useOptionalInbox();
  const directory = useMemo(
    () =>
      inbox
        ? new ContactDirectory(
            inbox.actor,
            inbox.repository,
            storageFor(inbox),
            inbox.reload,
          )
        : null,
    [inbox],
  );
  const channel = useMemo(
    () => (inbox && directory ? channelsFor(inbox, directory) : null),
    [inbox, directory],
  );
  const policy = useSyncExternalStore(
    channel?.subscribe ?? idleSubscribe,
    channel?.snapshot ?? idleSnapshot,
    channel?.snapshot ?? idleSnapshot,
  );
  useEffect(() => {
    if (channel) {
      const release = channel.retain();
      void channel.hydrate();
      return release;
    }
  }, [channel]);
  useEffect(
    () => inbox?.subscribe(() => directory?.reconcile()),
    [inbox, directory],
  );
  if (channel && !policy.ready)
    return policy.error ? (
      <ErrorState onRetry={() => void channel.hydrate()} />
    ) : (
      <Skeleton rows={3} />
    );
  return <Context.Provider value={directory}>{children}</Context.Provider>;
}
export const useContactDirectory = () => {
  const v = useContext(Context);
  if (!v) throw new Error("Se requiere una sesión ficticia.");
  return v;
};
export function useContactState(store: ContactStore) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return snapshot;
}
export function useContactFlags() {
  const d = useContactDirectory();
  return useSyncExternalStore(d.subscribeFlags, d.flags, d.flags);
}
