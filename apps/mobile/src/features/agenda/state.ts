import { storageFor } from "../team/storage";
import { connectorsFor } from "../calendar-settings/state";
import { AgendaStore } from "./core";
import { preferencesStorage } from "../../services/storage";
import type { InboxStore } from "../inbox/store-core";
const stores = new WeakMap<InboxStore, AgendaStore>();
export function agendaFor(inbox: InboxStore) {
  let store = stores.get(inbox);
  if (!store) {
    store = new AgendaStore(
      inbox.actor,
      inbox.repository.catalog.organizationId,
      storageFor(inbox),
      Date.now,
      connectorsFor(inbox),
      inbox.repository.team,
    );
    stores.set(inbox, store);
  }
  return store;
}
