import { storageFor } from "../team/storage";
import { useEffect, useSyncExternalStore } from "react";
import { useInbox } from "../inbox/store";
import type { InboxStore } from "../inbox/store-core";
import { preferencesStorage } from "../../services/storage";
import { CalendarConnectors } from "./core";
const stores = new WeakMap<InboxStore, CalendarConnectors>();
export function connectorsFor(inbox: InboxStore) {
  let store = stores.get(inbox);
  if (!store) {
    store = new CalendarConnectors(
      inbox.actor,
      inbox.repository.catalog.organizationId,
      storageFor(inbox),
    );
    stores.set(inbox, store);
  }
  return store;
}
export function useConnectors() {
  const store = connectorsFor(useInbox()),
    state = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    );
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return { store, state };
}
