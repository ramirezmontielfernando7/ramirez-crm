import React, {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { useOptionalInbox } from "../inbox/store";
import type { InboxStore } from "../inbox/store-core";
import { preferencesStorage } from "../../services/storage";
import { teamFor } from "../team/state";
import { PersonalizationStore, resolveAppearance } from "./core";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { ErrorState, Skeleton } from "../../components/ui";
const stores = new WeakMap<InboxStore, PersonalizationStore>();
export function personalizationFor(inbox: InboxStore) {
  let s = stores.get(inbox);
  if (!s) {
    s = new PersonalizationStore(
      teamFor(inbox.repository.catalog.organizationId),
      inbox.actor.id,
      preferencesStorage,
    );
    stores.set(inbox, s);
  }
  return s;
}
const Context = createContext<PersonalizationStore | null>(null);
export function useOptionalPersonalization() {
  return useContext(Context);
}
export function usePersonalization() {
  const store = useContext(Context);
  if (!store) throw Error("Personalización no disponible.");
  return {
    store,
    state: useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
  };
}
const idle = { ready: true, error: "", brand: null, personal: null };
const snap = () => idle;
const noop = () => () => {};
export function PersonalizationProvider({ children }: React.PropsWithChildren) {
  const inbox = useOptionalInbox(),
    store = inbox ? personalizationFor(inbox) : null;
  const state = useSyncExternalStore<
    ReturnType<PersonalizationStore["snapshot"]> | typeof idle
  >(store?.subscribe ?? noop, store?.snapshot ?? snap, store?.snapshot ?? snap);
  useEffect(() => {
    if (!store) return;
    const release = store.retain();
    void store.hydrate();
    return release;
  }, [store]);
  if (!store || !state.brand || !state.personal) return <>{children}</>;
  if (!state.ready)
    return state.error ? (
      <ErrorState onRetry={() => void store.hydrate()} />
    ) : (
      <Skeleton rows={3} />
    );
  return (
    <Context.Provider value={store}>
      <ThemeProvider
        profile={{
          ...resolveAppearance(state.brand, state.personal),
          name: state.brand.name,
          accent: state.brand.accent,
          asset: state.brand.asset,
        }}
        onMode={(theme) => store.personal({ theme })}
      >
        {children}
      </ThemeProvider>
    </Context.Provider>
  );
}
