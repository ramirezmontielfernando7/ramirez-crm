import React, { useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { Video, ChevronRight } from "lucide-react-native";
import { router } from "expo-router";
import { Screen } from "../../components/Screen";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageScroll,
  Section,
  Skeleton,
  Text,
} from "../../components/ui";
import { StudioBar } from "../studio/StudioBar";
import { useLayers } from "../../components/Layers";
import { useSession } from "../../state/SessionProvider";
import { useTheme } from "../../theme/ThemeProvider";
import { canAccess } from "../../domain/access";
import { useInbox, useInboxState } from "../inbox/store";
import { useConnectors } from "./state";
import { businessHours, type CalendarConnectors, type Provider } from "./core";
import { catalogKey } from "../catalog/core";
const labels = { zoom: "Zoom", meet: "Google Meet" };
export function CalendarSettingsScreen() {
  const { session, disabled } = useSession();
  return (
    <Screen>
      <StudioBar
        title="Agenda y conectores"
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/more")
        }
      />
      {session &&
      session.role !== "advisor" &&
      canAccess(session.role, "more", disabled) ? (
        <SettingsView />
      ) : (
        <EmptyState
          title="Acceso no permitido"
          message="Configurar conectores requiere Propietario o Coordinador."
        />
      )}
    </Screen>
  );
}
function SettingsView() {
  const { store, state } = useConnectors(),
    layers = useLayers(),
    { colors: c } = useTheme(),
    inbox = useInbox(),
    status = useInboxState().status;
  return (
    <PageScroll>
      {status === "offline" && (
        <Banner type="warning">
          Sin conexión · configuración ficticia local.
        </Banner>
      )}
      {!state.ready ? (
        state.error ? (
          <ErrorState onRetry={() => void store.reload()} />
        ) : (
          <Skeleton rows={4} />
        )
      ) : status === "loading" ? (
        <Skeleton rows={4} />
      ) : status === "error" ? (
        <ErrorState
          onRetry={() => {
            inbox.patch({ status: "normal" });
            void store.reload();
          }}
        />
      ) : (
        <>
          <Section>Horario de atención</Section>
          <Card>
            {businessHours.map((h) => (
              <View
                key={h.label}
                style={{ flexDirection: "row", paddingVertical: 6, gap: 12 }}
              >
                <Text kind="secondary" style={{ flex: 1 }}>
                  {h.label}
                </Text>
                <Text kind="secondary">{h.value}</Text>
              </View>
            ))}
          </Card>
          <Section>Conectores de reunión</Section>
          {status === "empty" ? (
            <EmptyState
              title="Sin conectores disponibles"
              message="La Agenda conserva tus citas locales, sin enlaces de reunión."
            />
          ) : (
            <Card>
              {(["zoom", "meet"] as const).map((provider) => (
                <Pressable
                  key={provider}
                  accessibilityRole="button"
                  accessibilityLabel={`${labels[provider]} · ${state.doc.enabled[provider] ? "Conectado" : "Sin conectar"}`}
                  onPress={() =>
                    layers.open({
                      kind: "dialog",
                      title: `${state.doc.enabled[provider] ? "Desconectar" : "Conectar"} ${labels[provider]}`,
                      content: (
                        <ConnectorDialog store={store} provider={provider} />
                      ),
                    })
                  }
                  style={{
                    minHeight: 56,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Video size={21} strokeWidth={1.8} color={c.text2} />
                  <Text style={{ flex: 1 }}>{labels[provider]}</Text>
                  <Text
                    kind="meta"
                    style={{
                      color: state.doc.enabled[provider] ? c.success : c.text3,
                    }}
                  >
                    {state.doc.enabled[provider] ? "Conectado" : "Sin conectar"}
                  </Text>
                  <ChevronRight color={c.text3} size={18} />
                </Pressable>
              ))}
            </Card>
          )}
        </>
      )}
    </PageScroll>
  );
}
function ConnectorDialog({
  store,
  provider,
}: {
  store: CalendarConnectors;
  provider: Provider;
}) {
  const initial = useRef(store.snapshot().doc),
    key = useRef(catalogKey()),
    busy = useRef(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    { close } = useLayers(),
    enabled = !initial.current.enabled[provider];
  const save = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await store.set(provider, enabled, initial.current.revision, key.current);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return (
    <>
      <Text>
        Esta acción cambia solo el conector de demostración. No inicia sesión en{" "}
        {labels[provider]}, no vincula cuentas ni crea reuniones reales.
      </Text>
      {!!error && <Banner type="danger">{error}</Banner>}
      <Button variant="secondary" disabled={pending} onPress={close}>
        Cancelar
      </Button>
      <Button
        disabled={pending}
        onPress={() => void save()}
      >{`${enabled ? "Conectar" : "Desconectar"} muestra`}</Button>
    </>
  );
}
