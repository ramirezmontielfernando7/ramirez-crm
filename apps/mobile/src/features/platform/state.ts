import { useEffect, useSyncExternalStore } from "react";
import { useInbox } from "../inbox/store";
import type { InboxStore } from "../inbox/store-core";
import { teamFor } from "../team/state";
import { PlatformStore } from "./core";
const stores = new WeakMap<InboxStore, PlatformStore>();
export function platformFor(inbox: InboxStore) {
  let s = stores.get(inbox);
  if (!s) {
    s = new PlatformStore(
      teamFor(inbox.repository.catalog.organizationId),
      inbox.actor.id,
    );
    stores.set(inbox, s);
  }
  return s;
}
export function usePlatform(load = true) {
  const store = platformFor(useInbox()),
    state = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    );
  useEffect(() => store.retain(), [store]);
  useEffect(() => {
    if (load && state.allowed && !state.ready && !state.error)
      void store.hydrate();
  }, [store, load, state.allowed]);
  return { store, state };
}
