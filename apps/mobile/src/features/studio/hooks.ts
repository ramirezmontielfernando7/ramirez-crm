import { useRef, useState, useSyncExternalStore } from "react";
import { useInbox } from "../inbox/store";
import { studioFor } from "./state";
export function useStudio() {
  const store = studioFor(useInbox());
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const state = useSyncExternalStore(
    store.library.subscribe,
    store.library.snapshot,
    store.library.snapshot,
  );
  return { store, state };
}
export function useStudioAction() {
  const busy = useRef(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo guardar localmente.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { run, pending, error };
}
