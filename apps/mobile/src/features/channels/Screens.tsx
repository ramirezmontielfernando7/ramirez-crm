import React, { useRef, useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import { QrCode } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  Banner,
  Button,
  Card,
  Choice,
  EmptyState,
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
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { modeLabels } from "../contact/model";
import { useChannels } from "./state";
import type { ChannelStore } from "./core";
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
        setError(e instanceof Error ? e.message : "Error local.");
      } finally {
        busy.current = false;
      }
    },
  };
}
function Ready({ children }: React.PropsWithChildren) {
  const { store, state } = useChannels();
  return store.team.actor(store.actor).role === "advisor" ? (
    <EmptyState
      title="Acceso no permitido"
      message="Tu perfil no administra canales."
    />
  ) : !state.ready ? (
    state.error ? (
      <ErrorState onRetry={() => void store.hydrate()} />
    ) : (
      <Skeleton rows={3} />
    )
  ) : (
    <>{children}</>
  );
}
function Confirm({
  run,
  message,
}: {
  run: () => Promise<unknown>;
  message: string;
}) {
  const a = useAction(),
    l = useLayers();
  return (
    <>
      <Text>{message}</Text>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <Button variant="secondary" onPress={l.close}>
        Cancelar
      </Button>
      <Button
        onPress={() =>
          void a.run(async () => {
            await run();
            l.close();
          })
        }
      >
        Confirmar
      </Button>
    </>
  );
}
export function ChannelScreen() {
  const { store, state } = useChannels(),
    l = useLayers();
  return (
    <Screen>
      <StudioBar title="Canales y conexiones" onBack={() => router.back()} />
      <PageScroll>
        <Ready>
          <NavRow
            label="Plantillas"
            onPress={() => router.push("/(tabs)/marketing?section=templates")}
          />
          {state.doc.addon && (
            <NavRow
              label="Conexión directa"
              onPress={() => router.push("/direct-settings")}
            />
          )}
          <Banner
            type={state.doc.status === "connected" ? "success" : "warning"}
          >
            {state.doc.status === "connected"
              ? "Conectado en simulación · +1 555 010 0100"
              : state.doc.status === "incomplete"
                ? "Conexión incompleta: falta el permiso de mensajes."
                : "Sin conexión ficticia"}
          </Banner>
          <NavRow
            label="Salud del número"
            onPress={() =>
              l.open({
                kind: "sheet",
                title: "Salud del número",
                content: <Health />,
              })
            }
          />
          <Card>
            <Text>Límite diario · 1,000 conversaciones ficticias</Text>
            <Text>
              Uso de hoy · {state.doc.status === "connected" ? 186 : 0}
            </Text>
            <Text>
              Webhook ·{" "}
              {state.doc.status === "connected"
                ? "Recibiendo (simulado)"
                : "Sin ruta ficticia"}
            </Text>
          </Card>
          <Button
            variant="tonal"
            onPress={() =>
              l.open({
                kind: "sheet",
                title: "Conectar WhatsApp",
                content: <Signup />,
              })
            }
          >
            Conectar con Facebook
          </Button>
          <Button
            variant="secondary"
            onPress={() =>
              l.open({
                kind: "dialog",
                title: "¿Desconectar?",
                content: (
                  <Confirm
                    run={() => store.disconnect()}
                    message="Solo desconecta la muestra Meta. No elimina mensajes ni cambia dispositivos personales."
                  />
                ),
              })
            }
          >
            Desconectar
          </Button>
        </Ready>
      </PageScroll>
    </Screen>
  );
}
function Signup() {
  const { store } = useChannels(),
    a = useAction(),
    l = useLayers();
  return (
    <>
      <Banner>
        Flujo de Meta simulado. No se abrirá un navegador, OAuth ni un servicio
        real.
      </Banner>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <Button
        onPress={() =>
          void a.run(async () => {
            await store.connect("success");
            l.close();
          })
        }
      >
        Continuar con Facebook
      </Button>
      <NavRow
        label="Conexión manual (token) · solo en la web"
        onPress={() =>
          l.toast("No se aceptan tokens reales en esta demostración")
        }
      />
    </>
  );
}
function Health() {
  const { state } = useChannels();
  return (
    <>
      <Card>
        <Text>Calidad · {state.doc.quality}</Text>
        <Text>Nivel de mensajes · 1,000 por día</Text>
        <Text>
          Usados hoy · {state.doc.status === "connected" ? "186 (19 %)" : "0"}
        </Text>
      </Card>
      <Banner type={state.doc.quality === "Alta" ? "info" : "warning"}>
        {state.doc.quality === "Alta"
          ? "Si la calidad baja a Media o Baja, verás un aviso ficticio."
          : "Calidad degradada en la muestra. Revisa la configuración."}
      </Banner>
    </>
  );
}
export function DirectSettings() {
  const { store, state } = useChannels(),
    a = useAction(),
    l = useLayers();
  return (
    <Screen>
      <StudioBar title="Conexión directa" onBack={() => router.back()} />
      <PageScroll>
        <Ready>
          {!state.doc.addon ? (
            <EmptyState
              title="Complemento no disponible"
              message="Solo aparece si la plataforma lo activa."
            />
          ) : (
            <>
              <Text>Complemento activado en el laboratorio ficticio.</Text>
              {(["meta", "direct", "hybrid"] as const).map((m) => (
                <Choice
                  radio
                  key={m}
                  label={modeLabels[m]}
                  checked={state.doc.defaultMode === m}
                  onPress={() => void a.run(() => store.mode(m))}
                />
              ))}
              <Text kind="meta">
                Modo predeterminado solo para chats nuevos. Cada chat conserva
                su configuración.
              </Text>
              {!!a.error && <Banner type="danger">{a.error}</Banner>}
              {state.doc.defaultMode !== "meta" && (
                <>
                  <NavRow
                    label="Aplicar a todos los chats"
                    onPress={() =>
                      l.open({
                        kind: "dialog",
                        title: "¿Aplicar a todos?",
                        content: (
                          <Confirm
                            run={() => store.bulk()}
                            message="Cambia el modo de todos los chats ficticios, sin borrar historial. Las excepciones individuales posteriores se conservan."
                          />
                        ),
                      })
                    }
                  />
                  <NavRow
                    label="Vincular dispositivo"
                    onPress={() =>
                      l.open({
                        kind: "sheet",
                        title: "Vincular dispositivo",
                        content: <Device />,
                      })
                    }
                  />
                  <NavRow
                    label="Límites de envío"
                    onPress={() =>
                      l.open({
                        kind: "dialog",
                        title: "Límites de envío",
                        content: (
                          <Text>
                            30 mensajes por minuto y pausas de demostración.
                            Esta app no ejecuta ningún envío por dispositivos.
                          </Text>
                        ),
                      })
                    }
                  />
                </>
              )}
              <Button
                variant="secondary"
                onPress={() =>
                  l.open({
                    kind: "sheet",
                    title: "Vincular dispositivo",
                    content: <Device />,
                  })
                }
              >
                Vincular muestra ficticia
              </Button>
            </>
          )}
        </Ready>
      </PageScroll>
    </Screen>
  );
}
function Device() {
  const { store } = useChannels(),
    a = useAction(),
    { colors: c } = useTheme(),
    l = useLayers();
  useState(() => {
    store.renew();
    return true;
  });
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
      <Text>
        Muestra no escaneable. Caduca en 60 segundos. No vincula WhatsApp real.
      </Text>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <Button variant="secondary" onPress={() => store.renew()}>
        Renovar código
      </Button>
      <Button
        onPress={() =>
          void a.run(async () => {
            await store.link();
            l.close();
          })
        }
      >
        Simular vinculación
      </Button>
    </>
  );
}
export function AdsSettings() {
  const { store, state } = useChannels(),
    [on, setOn] = useState(state.doc.ads),
    a = useAction();
  return (
    <Screen>
      <StudioBar title="Anuncios (Meta)" onBack={() => router.back()} />
      <PageScroll>
        <Ready>
          {store.team.actor(store.actor).role !== "owner" ? (
            <EmptyState
              title="Acceso no permitido"
              message="Solo propietario configura atribución."
            />
          ) : (
            <>
              <Switch
                label="Reportar eventos a Meta (CAPI)"
                value={on}
                onChange={setOn}
              />
              <Text kind="meta">
                Lead al abrir chat desde anuncio; Compra al ganar un trato. Solo
                eventos ficticios.
              </Text>
              <Field
                label="ID de la fuente de datos (Dataset)"
                value="demo-dataset-0000"
                editable={false}
              />
              <Field
                label="Token de acceso"
                value="••••••••0000"
                editable={false}
              />
              <Text kind="meta">
                Muestra fija. No se guardan ni aceptan credenciales reales.
              </Text>
              {!!a.error && <Banner type="danger">{a.error}</Banner>}
              <Button onPress={() => void a.run(() => store.ads(on))}>
                Guardar
              </Button>
            </>
          )}
        </Ready>
      </PageScroll>
    </Screen>
  );
}
export function ChannelLab() {
  const { store, state } = useChannels(),
    a = useAction();
  return (
    <Screen>
      <StudioBar title="Laboratorio de canales" onBack={() => router.back()} />
      <PageScroll>
        <Ready>
          <Banner>
            Solo estados locales. No modifica complementos, proveedores ni
            cuentas reales.
          </Banner>
          {!!a.error && <Banner type="danger">{a.error}</Banner>}
          <Button
            onPress={() => void a.run(() => store.addon(!state.doc.addon))}
          >
            {state.doc.addon
              ? "Desactivar complemento ficticio"
              : "Activar complemento ficticio"}
          </Button>
          <Button onPress={() => void a.run(() => store.connect("missing"))}>
            Simular permiso incompleto
          </Button>
          {(["Alta", "Media", "Baja"] as const).map((q) => (
            <Button
              key={q}
              variant="secondary"
              onPress={() => void a.run(() => store.quality(q))}
            >{`Calidad ${q}`}</Button>
          ))}
          <Button
            onPress={() =>
              void a.run(() =>
                store.report("demo-lead-1", "Lead", "demo-ctwa-ad-1"),
              )
            }
          >
            Simular Lead
          </Button>
          <Button
            onPress={() =>
              void a.run(() =>
                store.report("demo-purchase-1", "Compra", "demo-ctwa-ad-1"),
              )
            }
          >
            Simular Compra
          </Button>
          <Text>
            Eventos CAPI ficticios registrados: {state.doc.events.length}
          </Text>
          <NavRow
            label="Canales y conexiones"
            onPress={() => router.push("/channel-settings")}
          />
          <NavRow
            label="Anuncios (Meta)"
            onPress={() => router.push("/ads-settings")}
          />
        </Ready>
      </PageScroll>
    </Screen>
  );
}
