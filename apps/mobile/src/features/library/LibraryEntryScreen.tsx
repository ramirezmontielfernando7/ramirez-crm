import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "../../components/Screen";
import { Button, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { useSession } from "../../state/SessionProvider";
import { canAccess } from "../../domain/access";
import { useOptionalInbox } from "../inbox/store";
import { libraryFor } from "./state";
import { LibraryEditor } from "./LibraryView";
import type { LibraryStore } from "./core";
export function LibraryEntryScreen() {
  const inbox = useOptionalInbox(),
    { session, disabled } = useSession();
  const store = useMemo(() => (inbox ? libraryFor(inbox) : null), [inbox]);
  if (!store || !session || !canAccess(session.role, "crm", disabled))
    return (
      <Screen>
        <EmptyState
          title="Acceso no permitido"
          message="Tu perfil de prueba no tiene acceso a Biblioteca."
        />
      </Screen>
    );
  return (
    <Screen keyboard>
      <Entry store={store} />
    </Screen>
  );
}
function Entry({ store }: { store: LibraryStore }) {
  const s = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    { id } = useLocalSearchParams<{ id: string }>();
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  useEffect(() => () => store.back(), [store]);
  const close = () => {
    store.back();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/crm?section=library");
  };
  const target = id === "new" ? null : id;
  let allowed = typeof id === "string" && !!id;
  try {
    if (target) store.get(target);
    else if (!store.canManage) allowed = false;
  } catch {
    allowed = false;
  }
  if (!allowed)
    return (
      <EmptyState
        title="Entrada no disponible"
        message="No existe o tu perfil no tiene acceso."
        action={<Button onPress={close}>Volver a Biblioteca</Button>}
      />
    );
  if (s.status === "loading") return <Skeleton rows={4} />;
  if (!s.ready) return <ErrorState onRetry={() => void store.hydrate()} />;
  return (
    <LibraryEditor key={id} store={store} entryId={target} onClose={close} />
  );
}
