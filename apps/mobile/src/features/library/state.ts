import { storageFor } from "../team/storage";
import type { InboxStore } from "../inbox/store-core";
import { preferencesStorage } from "../../services/storage";
import { LibraryStore } from "./core";
const stores = new WeakMap<object, LibraryStore>();
/** The CRM tab and its internal editor share one session-scoped local model. */
export function libraryFor(inbox: InboxStore) {
  let store = stores.get(inbox);
  if (!store) {
    store = new LibraryStore(
      inbox.actor,
      "demo-org-cristal",
      storageFor(inbox),
    );
    stores.set(inbox, store);
  }
  return store;
}
