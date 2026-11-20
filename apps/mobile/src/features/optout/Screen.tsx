import { View } from "react-native";
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { router } from "expo-router";
import { Screen } from "../../components/Screen";
import {
  Banner,
  Button,
  ErrorState,
  Field,
  NavRow,
  PageScroll,
  Section,
  Skeleton,
  Switch,
  Text,
} from "../../components/ui";
import { StudioBar } from "../studio/StudioBar";
import { useInbox } from "../inbox/store";
import { useLayers } from "../../components/Layers";
import { teamFor } from "../team/state";
import { storageFor } from "../team/storage";
import type { InboxStore } from "../inbox/store-core";
import { OptOutStore } from "./core";
const stores = new WeakMap<InboxStore, OptOutStore>();
function optoutFor(inbox: InboxStore) {
  let s = stores.get(inbox);
  if (!s) {
    s = new OptOutStore(
      teamFor(inbox.repository.catalog.organizationId),
      inbox.actor.id,
      storageFor(inbox),
    );
    stores.set(inbox, s);
  }
  return s;
}
export function OptOutScreen({ lab = false }: { lab?: boolean }) {
  const inbox = useInbox(),
    store = optoutFor(inbox),
    s = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot),
    layers = useLayers(),
    [error, setError] = useState(""),
    [reply, setReply] = useState(""),
    busy = useRef(false);
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  useEffect(() => {
    if (s.ready) {
      setReply(s.doc.reply);
      for (const e of s.doc.events) {
        try {
          inbox.repository.markOptOut(inbox.actor, e.contact);
          inbox.reload();
        } catch {}
      }
    }
  }, [s.ready, s.doc, inbox]);
  const run = async (fn: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error local.");
    } finally {
      busy.current = false;
    }
  };
  return (
    <Screen>
      <StudioBar title="Bajas automáticas" onBack={() => router.back()} />
      <PageScroll>
        {!s.ready ? (
          s.error ? (
            <ErrorState onRetry={() => void store.hydrate()} />
          ) : (
            <Skeleton rows={4} />
          )
        ) : store.team.actor(store.actor).role === "advisor" ? (
          <Banner>
            Solo propietario o coordinador configura esta muestra.
          </Banner>
        ) : (
          <>
            <Switch
              label="Dar de baja con palabras clave"
              value={s.doc.enabled}
              onChange={(v) => {
                if (v) void run(() => store.enabled(true));
                else
                  layers.open({
                    kind: "dialog",
                    title: "¿Desactivar bajas por palabras clave?",
                    content: (
                      <>
                        <Text>
                          Solo cambia el simulador. Las bajas anteriores se
                          conservan.
                        </Text>
                        <Button onPress={layers.close}>Cancelar</Button>
                        <Button
                          onPress={() =>
                            void run(async () => {
                              await store.enabled(false);
                              layers.close();
                            })
                          }
                        >
                          Confirmar
                        </Button>
                      </>
                    ),
                  });
              }}
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {s.doc.words.map((w) => (
                <Button
                  variant="tonal"
                  key={w}
                  onPress={() =>
                    layers.open({
                      kind: "dialog",
                      title: "¿Quitar palabra?",
                      content: (
                        <>
                          <Text>{w}</Text>
                          <Button onPress={layers.close}>Cancelar</Button>
                          <Button
                            onPress={() =>
                              void run(async () => {
                                await store.remove(w);
                                layers.close();
                              })
                            }
                          >
                            Quitar
                          </Button>
                        </>
                      ),
                    })
                  }
                >
                  {w}
                </Button>
              ))}
            </View>
            <Button
              variant="secondary"
              onPress={() =>
                layers.open({
                  kind: "sheet",
                  title: "Agregar palabra",
                  content: (
                    <Add
                      save={(v) =>
                        run(async () => {
                          await store.add(v);
                          layers.close();
                        })
                      }
                    />
                  ),
                })
              }
            >
              Agregar
            </Button>
            <Field
              label="Respuesta automática"
              value={reply}
              onChangeText={setReply}
              multiline
              maxLength={1000}
            />
            <Button onPress={() => void run(() => store.reply(reply))}>
              Guardar respuesta
            </Button>
            {!!error && <Banner type="danger">{error}</Banner>}
            {lab && (
              <>
                <Section>Simulador local</Section>
                <Text>
                  Sin programación ni envíos. Coincide solo con el texto
                  completo, sin distinguir acentos o mayúsculas.
                </Text>
                {inbox.repository
                  .list(inbox.actor)
                  .filter((c) => !c.group)
                  .slice(0, 3)
                  .map((c) => (
                    <NavRow
                      key={c.id}
                      label={`Probar baja · ${c.name}`}
                      onPress={() =>
                        layers.open({
                          kind: "dialog",
                          title: "¿Simular baja del contacto?",
                          content: (
                            <>
                              <Text>
                                Se conserva contacto, trato e historial. La
                                respuesta solo se registra, no se envía.
                              </Text>
                              <Button onPress={layers.close}>Cancelar</Button>
                              <Button
                                onPress={() =>
                                  void run(async () => {
                                    await store.simulate(
                                      `demo-optout-${c.id}`,
                                      c.id,
                                      "STOP",
                                    );
                                    layers.close();
                                  })
                                }
                              >
                                Simular STOP
                              </Button>
                            </>
                          ),
                        })
                      }
                    />
                  ))}
                <Text>Eventos ejecutados ficticios: {s.doc.events.length}</Text>
              </>
            )}
          </>
        )}
      </PageScroll>
    </Screen>
  );
}
function Add({ save }: { save: (s: string) => Promise<unknown> }) {
  const [s, set] = useState("");
  return (
    <>
      <Field
        label="Palabra clave"
        value={s}
        onChangeText={set}
        maxLength={40}
      />
      <Button onPress={() => void save(s)}>Agregar palabra</Button>
    </>
  );
}
