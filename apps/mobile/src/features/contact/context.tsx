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
const Context = createContext<ContactDirectory | null>(null);
export function ContactProvider({ children }: React.PropsWithChildren) {
  const inbox = useOptionalInbox();
  const directory = useMemo(
    () =>
      inbox
        ? new ContactDirectory(
            inbox.actor,
            inbox.repository,
            preferencesStorage,
            inbox.reload,
          )
        : null,
    [inbox],
  );
  useEffect(
    () => inbox?.subscribe(() => directory?.reconcile()),
    [inbox, directory],
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
