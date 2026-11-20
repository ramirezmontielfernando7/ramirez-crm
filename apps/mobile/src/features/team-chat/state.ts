import { useEffect, useSyncExternalStore } from "react";
import type { InboxStore } from "../inbox/store-core";
import { useInbox } from "../inbox/store";
import { storageFor } from "../team/storage";
import { teamFor } from "../team/state";
import { TeamChatStore } from "./core";
const stores = new WeakMap<InboxStore, TeamChatStore>();
export function internalFor(inbox: InboxStore) {
  let s = stores.get(inbox);
  if (!s) {
    s = new TeamChatStore(
      teamFor(inbox.repository.catalog.organizationId),
      inbox.actor.id,
      storageFor(inbox),
    );
    stores.set(inbox, s);
  }
  return s;
}
export function useInternal() {
  const store = internalFor(useInbox()),
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
