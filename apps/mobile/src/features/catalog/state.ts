import { useEffect, useSyncExternalStore } from "react";
import { useInbox } from "../inbox/store";
export function useCatalog() {
  const store = useInbox().repository.catalog,
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
