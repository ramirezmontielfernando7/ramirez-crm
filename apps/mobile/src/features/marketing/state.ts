import { useEffect, useSyncExternalStore } from "react";
import type { InboxStore } from "../inbox/store-core";
import { useInbox } from "../inbox/store";
import { teamFor } from "../team/state";
import { storageFor } from "../team/storage";
import { templatesFor } from "../templates/state";
import { MarketingStore } from "./core";
const stores = new WeakMap<InboxStore, MarketingStore>();
export function marketingFor(inbox: InboxStore) {
  let s = stores.get(inbox);
  if (!s) {
    s = new MarketingStore(
      teamFor(inbox.repository.catalog.organizationId),
      inbox.actor.id,
      inbox.repository,
      templatesFor(inbox),
      storageFor(inbox),
      Date.now,
      () => inbox.marketingEnabled,
    );
    stores.set(inbox, s);
  }
  return s;
}
export function useMarketing() {
  const inbox = useInbox(),
    store = marketingFor(inbox),
    state = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    );
  useEffect(() => {
    const release = store.retain();
    const unsub = store.subscribe(() => inbox.reload());
    void store.hydrate();
    return () => {
      unsub();
      release();
    };
  }, [store, inbox]);
  return {
    store,
    state: inbox.marketingEnabled ? state : { ...state, ready: false },
  };
}
