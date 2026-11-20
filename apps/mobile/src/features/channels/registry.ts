import type { InboxStore } from "../inbox/store-core";
import type { ContactDirectory } from "../contact/core";
import { teamFor } from "../team/state";
import { storageFor } from "../team/storage";
import { ChannelStore } from "./core";
const stores = new WeakMap<ContactDirectory, ChannelStore>();
export function channelsFor(inbox: InboxStore, d: ContactDirectory) {
  let s = stores.get(d);
  if (!s) {
    s = new ChannelStore(
      teamFor(inbox.repository.catalog.organizationId),
      inbox.actor.id,
      storageFor(inbox),
      (p) => d.applyChannelPolicy(p),
    );
    stores.set(d, s);
  }
  return s;
}
