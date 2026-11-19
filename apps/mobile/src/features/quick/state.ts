import { useEffect, useSyncExternalStore } from "react";
import { useInbox } from "../inbox/store";
import type { InboxStore } from "../inbox/store-core";
import { preferencesStorage } from "../../services/storage";
import { QuickRepository } from "./core";
const stores = new WeakMap<InboxStore, QuickRepository>();
export function quickFor(inbox: InboxStore) {
  let store = stores.get(inbox);
  if (!store) {
    store = new QuickRepository(
      inbox.actor,
      "demo-org-cristal",
      preferencesStorage,
    );
    stores.set(inbox, store);
  }
  return store;
}
export function useQuick() {
  const store = quickFor(useInbox()),
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
