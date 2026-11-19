import { libraryFor } from "../library/state";
import type { InboxStore } from "../inbox/store-core";
import { StudioStore } from "./core";
const stores = new WeakMap<InboxStore, StudioStore>();
export function studioFor(inbox: InboxStore) {
  let s = stores.get(inbox);
  if (!s) {
    s = new StudioStore(libraryFor(inbox), inbox.repository);
    stores.set(inbox, s);
  }
  return s;
}
