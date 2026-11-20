import { useEffect, useSyncExternalStore } from "react";
import { useInbox } from "../inbox/store";
import type { InboxStore } from "../inbox/store-core";
import { useContactDirectory } from "../contact/context";
import type { ContactDirectory } from "../contact/core";
import { teamFor } from "../team/state";
import { storageFor } from "../team/storage";
import { ChannelStore } from "./core";
export { channelsFor } from "./registry";
import { channelsFor } from "./registry";
export function useChannels() {
  const inbox = useInbox(),
    d = useContactDirectory(),
    store = channelsFor(inbox, d),
    state = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    );
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return { store, state };
}
