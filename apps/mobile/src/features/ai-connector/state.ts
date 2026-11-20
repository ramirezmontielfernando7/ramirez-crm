import { useEffect, useSyncExternalStore } from "react";
import type { InboxStore } from "../inbox/store-core";
import { useInbox } from "../inbox/store";
import { teamFor } from "../team/state";
import { storageFor } from "../team/storage";
import { ConnectorStore } from "./core";
const stores = new WeakMap<InboxStore, ConnectorStore>();
export function connectorFor(inbox: InboxStore) {
  let s = stores.get(inbox);
  if (!s) {
    s = new ConnectorStore(
      teamFor(inbox.repository.catalog.organizationId),
      inbox.actor.id,
      storageFor(inbox),
    );
    stores.set(inbox, s);
  }
  return s;
}
export function useConnector() {
  const store = connectorFor(useInbox()),
    state = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    );
  useEffect(() => {
    const release = store.retain();
    void store.hydrate();
    return release;
  }, [store]);
  return { store, state };
}
