import { preferencesStorage } from "../../services/storage";
import { guardedStorage } from "./guarded-storage";
import { teamFor } from "./state";
import type { InboxStore } from "../inbox/store-core";
const ports = new WeakMap<InboxStore, ReturnType<typeof guardedStorage>>();
export function storageFor(inbox: InboxStore) {
  let p = ports.get(inbox);
  if (!p) {
    p = guardedStorage(
      teamFor(inbox.repository.catalog.organizationId),
      inbox.actor.id,
      preferencesStorage,
    );
    ports.set(inbox, p);
  }
  return p;
}
