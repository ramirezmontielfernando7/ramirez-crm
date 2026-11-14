import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState } from "react-native";
import { LocalNotifications } from "./local";
import { observeLocalResponses } from "./local-port";
import { Button, Section, Text, Banner } from "../../components/ui";
import { DemoNotificationBackend } from "./adapters/demo";
const Context = createContext<LocalNotifications | null>(null);
export function LocalProvider({
  local,
  initialized,
  children,
}: React.PropsWithChildren<{
  local: LocalNotifications;
  initialized: boolean;
}>) {
  const s = useSyncExternalStore(
    local.store.subscribe,
    local.store.snapshot,
    local.store.snapshot,
  );
  const setError = local.failure;
  useEffect(() => {
    if (!initialized) return;
    void local
      .reconcile()
      .catch(() => setError("No se pudieron retirar los avisos locales."));
  }, [local, initialized, s.identity, s.error, s.result]);
  useEffect(() => {
    if (!initialized || !s.identity) return;
    let live = true,
      stop: (() => void) | undefined;
    void observeLocalResponses((id) => local.tap(id))
      .then((remove) => {
        if (live) stop = remove;
        else remove();
      })
      .catch((e) => setError(String(e)));
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active")
        void local
          .permission()
          .then(() => local.reconcile())
          .catch((e) => setError(String(e)));
    });
    void local.permission().catch((e) => setError(String(e)));
    return () => {
      live = false;
      stop?.();
      sub.remove();
    };
  }, [local, initialized, s.identity]);
  return (
    <Context.Provider value={local}>
      {children}
      {/* No visible UI outside the lab. */}
    </Context.Provider>
  );
}
export function LocalLab() {
  const local = useContext(Context)!;
  const state = useSyncExternalStore(
    local.subscribe,
    local.snapshot,
    local.snapshot,
  );
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<ReturnType<
    DemoNotificationBackend["publish"]
  > | null>(null);
  const run = (fn: () => unknown) => {
    setError("");
    void Promise.resolve()
      .then(fn)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Falló la prueba local"),
      );
  };
  const sample = (seconds: number) => {
    const i = local.store.snapshot().identity;
    if (!i) throw Error("Inicia una sesión ficticia primero.");
    const e = (local.store.backend as DemoNotificationBackend).publish({
      eventId: `demo-local-${Date.now()}-${++counter}`,
      organizationId: i.organizationId,
      conversationId:
        i.userId === "demo-advisor" ? "demo-conv-3" : "demo-conv-1",
    });
    setLatest(e);
    return local.send(e, seconds);
  };
  return (
    <>
      <Section>Pruebas locales Android · T-M5B</Section>
      <Banner>
        Solo muestras ficticias. El permiso del sistema se solicita al pulsar el
        botón. Sin push remoto; sin sonido ni vibración.
      </Banner>
      <Text>Permiso Android: {state.permission}</Text>
      <Text accessibilityLiveRegion="polite">{state.result}</Text>
      {!!error && <Banner type="danger">{error}</Banner>}
      <Button onPress={() => run(() => local.permission(true))}>
        Solicitar permiso Android
      </Button>
      <Button variant="secondary" onPress={() => run(() => local.permission())}>
        Consultar permiso Android
      </Button>
      <Button onPress={() => run(() => sample(1))}>
        Probar aviso local ahora
      </Button>
      <Button variant="secondary" onPress={() => run(() => sample(15))}>
        Probar aviso local en 15 segundos
      </Button>
      <Button
        variant="secondary"
        onPress={() => run(() => latest && local.send(latest))}
      >
        Repetir aviso local
      </Button>
      <Button variant="secondary" onPress={() => run(() => local.clear())}>
        Limpiar avisos locales
      </Button>
    </>
  );
}
let counter = 0;
