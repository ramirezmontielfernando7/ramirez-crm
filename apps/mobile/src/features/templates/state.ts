import { useEffect, useSyncExternalStore } from "react";
import type { InboxStore } from "../inbox/store-core";
import { useInbox } from "../inbox/store";
import { teamFor } from "../team/state";
import { storageFor } from "../team/storage";
import { TemplateStore } from "./core";
const stores = new WeakMap<InboxStore, TemplateStore>();
export function templatesFor(inbox: InboxStore) {
  let s = stores.get(inbox);
  if (!s) {
    s = new TemplateStore(
      teamFor(inbox.repository.catalog.organizationId),
      inbox.actor.id,
      storageFor(inbox),
      () => inbox.marketingEnabled,
    );
    stores.set(inbox, s);
  }
  return s;
}
export function useTemplates() {
  const store = templatesFor(useInbox()),
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
