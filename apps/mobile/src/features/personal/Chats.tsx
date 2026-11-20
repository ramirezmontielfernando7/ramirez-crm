import { projectCustomer } from "./project";
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FlatList, View, TextInput, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  MoreVertical,
  Plus,
  Send,
  Smile,
  Paperclip,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  AppBar,
  IconButton,
  SegmentedControl,
} from "../../components/ModuleUi";
import {
  Avatar,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  NavRow,
  PageScroll,
  Skeleton,
  Switch,
  Text,
} from "../../components/ui";
import { StudioBar } from "../studio/StudioBar";
import { useInbox } from "../inbox/store";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { catalogKey } from "../catalog/core";
import { personalFor } from "./Settings";
function usePersonal() {
  const inbox = useInbox(),
    store = personalFor(inbox),
    state = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    );
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return { inbox, store, state };
}
function useAction() {
  const busy = useRef(false),
    [error, setError] = useState("");
  return {
    error,
    run: async (fn: () => Promise<unknown>) => {
      if (busy.current) return;
      busy.current = true;
      setError("");
      try {
        await fn();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Falló la operación ficticia.",
        );
      } finally {
        busy.current = false;
      }
    },
  };
}
export function PersonalList() {
  const { inbox, store, state } = usePersonal(),
    layers = useLayers(),
    [archived, setArchived] = useState(false),
    a = useAction();
  return (
    <Screen>
      <AppBar
        module
        title="Bandeja"
        actions={
          <IconButton
            icon={Plus}
            label="Nuevo chat personal"
            onPress={() =>
              layers.open({
                kind: "sheet",
                title: "Nuevo chat personal",
                content: <NewChat />,
              })
            }
          />
        }
      />
      <View style={{ padding: 16 }}>
        <SegmentedControl
          options={[
            { key: "clients", label: "Clientes" },
            { key: "team", label: "Equipo" },
            { key: "number", label: "Mi número" },
          ]}
          value="number"
          onChange={(v) =>
            router.replace(
              v === "team"
                ? "/(tabs)/inbox?area=team"
                : v === "number"
                  ? "/(tabs)/inbox?area=number"
                  : "/(tabs)/inbox",
            )
          }
        />
      </View>
      <Banner>
        Mi número · Privado. El equipo y la IA no leen tu historial personal.
        Solo datos ficticios.
      </Banner>
      {!state.ready ? (
        state.error ? (
          <ErrorState onRetry={() => void store.hydrate()} />
        ) : (
          <Skeleton rows={4} />
        )
      ) : !state.doc.linked ? (
        <EmptyState
          title="Sin dispositivo vinculado"
          message="Vincula una muestra ficticia desde Mi número."
          action={
            <Button onPress={() => router.push("/personal-settings")}>
              Mi número
            </Button>
          }
        />
      ) : (
        <>
          <NavRow
            label={archived ? "Volver a activos" : "Ver archivados"}
            onPress={() => setArchived(!archived)}
          />
          <FlatList
            data={(state.doc.rooms ?? []).filter(
              (r) => r.archived === archived && !r.client,
            )}
            keyExtractor={(r) => r.id}
            ListEmptyComponent={
              <EmptyState
                title="Aún no hay chats"
                message="Crea un chat con un número ficticio."
              />
            }
            renderItem={({ item: r }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Abrir ${r.name}`}
                onPress={() => router.push(`/personal-chat?id=${r.id}`)}
                style={{
                  minHeight: 80,
                  padding: 16,
                  flexDirection: "row",
                  gap: 12,
                }}
              >
                <Avatar name={r.name} />
                <View style={{ flex: 1 }}>
                  <Text weight="medium">{r.name}</Text>
                  <Text kind="meta" numberOfLines={1}>
                    {r.messages.at(-1)?.text ?? r.phone}
                  </Text>
                </View>
              </Pressable>
            )}
          />
          {(state.doc.rooms ?? [])
            .filter((r) => r.client)
            .map((r) => (
              <NavRow
                key={r.id}
                label={`Abrir en Clientes · ${r.name}`}
                onPress={() => {
                  void a.run(async () => {
                    const c = projectCustomer(inbox, store, r.id);
                    router.push(`/conversation/${c.id}`);
                  });
                }}
              />
            ))}
          {!!a.error && <Banner type="danger">{a.error}</Banner>}
        </>
      )}
    </Screen>
  );
}
function NewChat() {
  const { store } = usePersonal(),
    [phone, setPhone] = useState("+1 555 010 "),
    a = useAction(),
    layers = useLayers();
  return (
    <>
      <Field label="Número de teléfono" value={phone} onChangeText={setPhone} />
      <Text kind="meta">
        Solo +1 555 010 XXXX. No se leen contactos del teléfono.
      </Text>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <Button
        onPress={() => {
          layers.close();
        }}
      >
        Cancelar
      </Button>
      <Button
        onPress={() =>
          void a.run(async () => {
            const id = await store.create(phone);
            layers.close();
            router.push(`/personal-chat?id=${id}`);
          })
        }
      >
        Abrir chat
      </Button>
    </>
  );
}
export function PersonalChat() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    { store, state } = usePersonal();
  return (
    <Screen keyboard>
      {!state.ready ? (
        state.error ? (
          <ErrorState onRetry={() => void store.hydrate()} />
        ) : (
          <Skeleton rows={4} />
        )
      ) : state.doc.rooms?.some((r) => r.id === id) ? (
        <Thread key={id} id={id} />
      ) : (
        <EmptyState
          title="Acceso no permitido"
          message="Este chat no pertenece a tu espacio personal."
        />
      )}
    </Screen>
  );
}
function Thread({ id }: { id: string }) {
  const { store } = usePersonal(),
    r = store.room(id),
    [text, setText] = useState(r.draft),
    a = useAction(),
    key = useRef(catalogKey()),
    { colors: c } = useTheme(),
    layers = useLayers();
  return (
    <>
      <StudioBar
        title={r.name}
        subtitle={`Mi número · ${r.phone}`}
        onBack={() => router.back()}
        actions={
          <IconButton
            icon={MoreVertical}
            label="Opciones del chat personal"
            onPress={() =>
              layers.open({
                kind: "sheet",
                title: "Opciones del chat",
                content: <Options id={id} />,
              })
            }
          />
        }
      />
      <Banner>
        {r.private ? "Privado" : "Metadatos compartibles solo con autorización"}{" "}
        · simulación, sin WhatsApp real
      </Banner>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <FlatList
        style={{ backgroundColor: c.sunken }}
        data={[...r.messages].sort((a, b) => a.at - b.at)}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          <EmptyState
            title="Sin mensajes"
            message="Envía una muestra ficticia."
          />
        }
        renderItem={({ item: m }) => (
          <View
            style={{
              alignSelf: "flex-end",
              maxWidth: "85%",
              padding: 12,
              borderRadius: 14,
              backgroundColor: c.bubbleTeam,
            }}
          >
            <Text>{m.text}</Text>
            <Text kind="meta">
              {new Date(m.at).toLocaleTimeString("es-MX")} · Simulado
            </Text>
          </View>
        )}
      />
      {!store.snapshot().doc.linked || r.archived || r.client ? (
        <Banner>
          Chat sin envío · desvinculado, archivado o trasladado a Clientes.
        </Banner>
      ) : (
        <View
          style={{
            padding: 12,
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 8,
          }}
        >
          <IconButton
            icon={Smile}
            label="Emojis personales"
            onPress={() =>
              layers.open({
                kind: "sheet",
                title: "Emojis",
                content: (
                  <Button
                    onPress={() => {
                      const v = text + " 🙂";
                      setText(v);
                      void store
                        .draft(id, v)
                        .catch(() =>
                          layers.toast("No se pudo guardar el borrador"),
                        );
                      layers.close();
                    }}
                  >
                    🙂
                  </Button>
                ),
              })
            }
          />
          <TextInput
            accessibilityLabel="Mensaje personal"
            placeholder="Mensaje"
            placeholderTextColor={c.text3}
            multiline
            maxLength={4000}
            value={text}
            onChangeText={(v) => {
              setText(v);
              void store
                .draft(id, v)
                .catch(() =>
                  layers.toast("No se pudo guardar el borrador local."),
                );
            }}
            style={{
              flex: 1,
              minHeight: 48,
              maxHeight: 120,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: c.borderStrong,
              padding: 12,
              color: c.text,
              fontFamily: "Inter_400Regular",
              fontSize: 15,
            }}
          />
          <IconButton
            icon={Paperclip}
            label="Adjunto personal ficticio"
            onPress={() =>
              layers.open({
                kind: "sheet",
                title: "Adjuntar",
                content: (
                  <>
                    <Text>
                      Solo muestra de texto, sin archivo ni acceso al teléfono.
                    </Text>
                    <Button
                      onPress={() => {
                        const v = text + " [Documento ficticio: muestra.pdf]";
                        setText(v);
                        void store
                          .draft(id, v)
                          .catch(() =>
                            layers.toast("No se pudo guardar el borrador"),
                          );
                        layers.close();
                      }}
                    >
                      Documento ficticio
                    </Button>
                  </>
                ),
              })
            }
          />
          <IconButton
            icon={Send}
            label="Enviar personal"
            onPress={() =>
              void a.run(async () => {
                await store.send(id, text, key.current);
                setText("");
                key.current = catalogKey();
              })
            }
          />
        </View>
      )}
    </>
  );
}
function Options({ id }: { id: string }) {
  const { store } = usePersonal(),
    r = store.room(id),
    layers = useLayers(),
    a = useAction();
  return (
    <>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <Switch
        label="Es cliente"
        value={r.client}
        onChange={() =>
          layers.open({
            kind: "dialog",
            title: "¿Pasar a Clientes?",
            content: (
              <>
                <Text>
                  Autoriza copiar nombre y número ficticios. El historial
                  personal no se copia. La copia en Clientes se conserva; la IA
                  permanece apagada.
                </Text>
                <Button onPress={layers.close}>Cancelar</Button>
                <ConfirmClient id={id} />
              </>
            ),
          })
        }
      />
      <Switch
        label="Privado"
        value={r.private}
        onChange={(v) => void a.run(() => store.privacy(id, v))}
      />
      <NavRow
        label={r.archived ? "Desarchivar" : "Archivar"}
        onPress={() =>
          void a.run(async () => {
            await store.archive(id, !r.archived);
            layers.close();
            router.replace("/(tabs)/inbox?area=number");
          })
        }
      />
      <NavRow
        label="Ajustes de Mi número"
        onPress={() => {
          layers.close();
          router.push("/personal-settings");
        }}
      />
    </>
  );
}
function ConfirmClient({ id }: { id: string }) {
  const { store, inbox } = usePersonal(),
    a = useAction(),
    layers = useLayers();
  return (
    <>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <Button
        onPress={() =>
          void a.run(async () => {
            await store.convert(id);
            const r = store.room(id),
              c = projectCustomer(inbox, store, r.id);
            layers.close();
            router.replace(`/conversation/${c.id}`);
          })
        }
      >
        Confirmar traspaso ficticio
      </Button>
    </>
  );
}
