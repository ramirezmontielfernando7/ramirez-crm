import React, { useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { QrCode } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  Banner,
  Button,
  ErrorState,
  PageScroll,
  NavRow,
  Section,
  Skeleton,
  Switch,
  Text,
} from "../../components/ui";
import { StudioBar } from "../studio/StudioBar";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { useInbox } from "../inbox/store";
import { teamFor } from "../team/state";
import { storageFor } from "../team/storage";
import type { InboxStore } from "../inbox/store-core";
import { PersonalStore, privacyLabels } from "./core";
const stores = new WeakMap<InboxStore, PersonalStore>();
export function personalFor(inbox: InboxStore) {
  let s = stores.get(inbox);
  if (!s) {
    s = new PersonalStore(
      teamFor(inbox.repository.catalog.organizationId),
      inbox.actor.id,
      storageFor(inbox),
    );
    stores.set(inbox, s);
  }
  return s;
}
export function PersonalSettings() {
  const store = personalFor(useInbox()),
    s = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot),
    layers = useLayers(),
    [error, setError] = useState("");
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return (
    <Screen>
      <StudioBar title="Mi número" onBack={() => router.back()} />
      <PageScroll>
        {!s.ready ? (
          s.error ? (
            <ErrorState onRetry={() => void store.hydrate()} />
          ) : (
            <Skeleton rows={4} />
          )
        ) : (
          <>
            <Banner>
              {s.doc.linked
                ? "Vinculado en simulación · Teléfono ficticio"
                : "Sin dispositivo ficticio vinculado"}
            </Banner>
            <Section>Privacidad (todo apagado por defecto)</Section>
            {privacyLabels.map((label, i) => (
              <Switch
                key={label}
                label={label}
                value={s.doc.privacy[i]!}
                onChange={(v) => {
                  setError("");
                  void store
                    .setPrivacy(i, v)
                    .catch(() =>
                      setError("No se pudo guardar la preferencia local."),
                    );
                }}
              />
            ))}
            {!!error && <Banner type="danger">{error}</Banner>}
            <Button
              variant="secondary"
              onPress={() =>
                layers.open({
                  kind: "sheet",
                  title: "Vincular dispositivo",
                  content: <LinkSample store={store} />,
                })
              }
            >
              Vincular otro dispositivo
            </Button>
            {store.team.actor(store.actor).role !== "advisor" && (
              <NavRow
                label="Números del equipo"
                onPress={() =>
                  layers.open({
                    kind: "sheet",
                    title: "Números del equipo",
                    content: (
                      <>
                        <Text>
                          No se comparten números personales en esta muestra.
                        </Text>
                        {store.team.people().map((p) => (
                          <Text key={p.id}>
                            {p.name} · Sin número ficticio compartido
                          </Text>
                        ))}
                      </>
                    ),
                  })
                }
              />
            )}
          </>
        )}
      </PageScroll>
    </Screen>
  );
}
function LinkSample({ store }: { store: PersonalStore }) {
  const { colors: c } = useTheme(),
    [expires, setExpires] = useState(() => store.renew()),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    layers = useLayers();
  return (
    <>
      <View
        style={{
          width: 190,
          height: 190,
          alignSelf: "center",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2,
          borderStyle: "dashed",
          borderRadius: 16,
          borderColor: c.borderStrong,
        }}
      >
        <QrCode size={48} color={c.text3} />
      </View>
      <Text kind="meta">
        Muestra ficticia, no escaneable. Caduca en 60 s. No abre WhatsApp ni
        vincula dispositivos reales.
      </Text>
      <Text kind="meta">
        Vigencia de muestra: {new Date(expires).toLocaleTimeString("es-MX")}
      </Text>
      {!!error && <Banner type="danger">{error}</Banner>}
      <Button
        variant="secondary"
        onPress={() => {
          setExpires(store.renew());
          setError("");
        }}
      >
        Renovar código
      </Button>
      <Button
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void store
            .link()
            .then(() => {
              layers.close();
              layers.toast("Dispositivo ficticio vinculado");
            })
            .catch((e) => {
              setError(e.message);
              setBusy(false);
            });
        }}
      >
        Simular vinculación
      </Button>
    </>
  );
}
