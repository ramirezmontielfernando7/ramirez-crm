import React, { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { Screen } from "../../components/Screen";
import {
  Banner,
  Button,
  Card,
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
import { catalogKey } from "../catalog/core";
import { roleLabels, roles } from "../../domain/access";
import { useConnector } from "./state";
import {
  actionLabels,
  kinds,
  serverAddress,
  type Connection,
  type Policy,
  type ConnectorStore,
} from "./core";
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
        setError(e instanceof Error ? e.message : "Falló la operación local.");
      } finally {
        busy.current = false;
      }
    },
  };
}
function Ready({ children }: React.PropsWithChildren) {
  const { store, state } = useConnector();
  return !state.ready ? (
    state.error ? (
      <ErrorState onRetry={() => void store.hydrate()} />
    ) : (
      <Skeleton rows={4} />
    )
  ) : (
    <>{children}</>
  );
}
export function ConnectorSettings() {
  return (
    <Screen>
      <StudioBar title="Conector del equipo" onBack={() => router.back()} />
      <PageScroll>
        <Ready>
          <PolicyForm />
        </Ready>
      </PageScroll>
    </Screen>
  );
}
function PolicyForm() {
  const { store, state } = useConnector(),
    a = useAction(),
    layers = useLayers(),
    [limit, setLimit] = useState(String(state.doc.policy.dailyLimit));
  useEffect(
    () => setLimit(String(state.doc.policy.dailyLimit)),
    [state.doc.policy.dailyLimit],
  );
  const update = (patch: Partial<Policy>) =>
    a.run(() => {
      const d = store.snapshot().doc;
      return store.configure({ ...d.policy, ...patch }, d.revision);
    });
  const confirm = (title: string, patch: Partial<Policy>) =>
    layers.open({
      kind: "dialog",
      title,
      content: (
        <Confirm
          message="Solo cambia autorizaciones ficticias. El historial se conserva; no se activa ningún servicio."
          run={() => update(patch)}
        />
      ),
    });
  if (store.team.actor(store.actor).role !== "owner")
    return (
      <EmptyState
        title="Acceso no permitido"
        message="Solo Propietario configura el conector del equipo."
      />
    );
  return (
    <>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <Switch
        label="Conector de IA encendido"
        value={state.doc.policy.enabled}
        onChange={(v) =>
          v
            ? void update({ enabled: v })
            : confirm("¿Pausar el conector ficticio?", { enabled: v })
        }
      />
      <Section>Quién puede conectar</Section>
      {roles.map((r) => (
        <Switch
          key={r}
          label={roleLabels[r]}
          value={state.doc.policy.roles.includes(r)}
          onChange={(v) => {
            const list = store.snapshot().doc.policy.roles;
            const patch = {
              roles: v ? [...list, r] : list.filter((x) => x !== r),
            };
            if (v) void update(patch);
            else confirm(`¿Retirar acceso a ${roleLabels[r]}?`, patch);
          }}
        />
      ))}
      <Field
        label="Tope diario de acciones por persona"
        value={limit}
        onChangeText={setLimit}
        keyboardType="number-pad"
        maxLength={4}
      />
      <Button
        variant="secondary"
        onPress={() => void update({ dailyLimit: Number(limit) })}
      >
        Guardar tope
      </Button>
      <Text kind="meta">
        Entre 1 y 1000 acciones ficticias por día UTC. No consume créditos.
      </Text>
      <Section>Funciones avanzadas</Section>
      <Switch
        label="Exportar/importar contactos"
        value={state.doc.policy.transfer}
        onChange={(v) =>
          v
            ? confirm("¿Permitir transferencia simulada?", { transfer: v })
            : void update({ transfer: v })
        }
      />
      <Switch
        label="Puede lanzar campañas"
        value={state.doc.policy.campaign}
        onChange={(v) =>
          v
            ? confirm("¿Permitir campañas simuladas?", { campaign: v })
            : void update({ campaign: v })
        }
      />
      <Text kind="meta">
        Sin este permiso, la IA solo deja borradores. Este laboratorio nunca
        envía campañas ni exporta datos.
      </Text>
    </>
  );
}
function Confirm({
  message,
  run,
}: {
  message: string;
  run: () => Promise<unknown>;
}) {
  const layers = useLayers(),
    a = useAction();
  return (
    <>
      <Text>{message}</Text>
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <Button variant="secondary" onPress={layers.close}>
        Cancelar
      </Button>
      <Button
        onPress={() =>
          void a.run(async () => {
            await run();
            layers.close();
          })
        }
      >
        Confirmar
      </Button>
    </>
  );
}
export function MyAi() {
  return (
    <Screen>
      <StudioBar title="Mi IA" onBack={() => router.back()} />
      <PageScroll>
        <Ready>
          <MyAiContent />
        </Ready>
      </PageScroll>
    </Screen>
  );
}
function MyAiContent() {
  const { store } = useConnector(),
    layers = useLayers(),
    role = store.team.actor(store.actor).role,
    cs = store.ownConnections();
  return (
    <>
      <Banner>
        Conecta tu Claude o ChatGPT. Actuará como tú, con tus permisos. Aquí
        solo se simula la autorización.
      </Banner>
      <Card>
        <Text kind="meta">Dirección del servidor</Text>
        <Text>{serverAddress}</Text>
        <Button
          variant="tonal"
          onPress={() =>
            layers.toast("Copiado en simulación · no se abre ninguna dirección")
          }
        >
          Copiar
        </Button>
      </Card>
      <Section>Tus conexiones</Section>
      {!cs.length && (
        <EmptyState
          title="Sin conexiones"
          message="Autoriza una conexión ficticia para probar sus permisos."
        />
      )}
      {cs.map((c) => (
        <NavRow
          key={c.id}
          label={`${c.provider} · «${c.name}» · ${store.reason(c.id) ? "Sin autorización" : "Activa"}`}
          onPress={() =>
            layers.open({
              kind: "sheet",
              title: "Conexión personal",
              content: <ConnectionEditor connection={c} store={store} />,
            })
          }
        />
      ))}
      {(["Claude", "ChatGPT"] as const).map((provider) => (
        <Button
          key={provider}
          variant="secondary"
          onPress={() =>
            layers.open({
              kind: "dialog",
              title: `Autorizar ${provider} en simulación`,
              content: <Connect provider={provider} store={store} />,
            })
          }
        >
          {`Simular autorización · ${provider}`}
        </Button>
      ))}
      <Section>Qué hizo tu IA</Section>
      <NavRow
        label="Actividad reciente"
        onPress={() => router.push("/my-ai-activity")}
      />
      <Text kind="meta">Nunca incluye el texto de los mensajes.</Text>
      {role === "owner" && (
        <NavRow
          label="Conector del equipo"
          onPress={() => router.push("/ai-connector-settings")}
        />
      )}
    </>
  );
}
function Connect({
  provider,
  store,
}: {
  provider: Connection["provider"];
  store: ConnectorStore;
}) {
  const [name, setName] = useState(provider === "Claude" ? "Joe" : "Asistente"),
    a = useAction(),
    layers = useLayers();
  return (
    <>
      <Text>
        Autorización ficticia con tu rol y organización actuales. No abre OAuth,
        genera tokens ni conecta servicios.
      </Text>
      <Field
        label="Nombre de la conexión"
        value={name}
        onChangeText={setName}
        maxLength={40}
      />
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <Button variant="secondary" onPress={layers.close}>
        Cancelar
      </Button>
      <Button
        onPress={() =>
          void a.run(async () => {
            await store.connect(provider, name);
            layers.close();
          })
        }
      >
        Autorizar muestra
      </Button>
    </>
  );
}
function ConnectionEditor({
  connection: c,
  store,
}: {
  connection: Connection;
  store: ConnectorStore;
}) {
  const [name, setName] = useState(c.name),
    a = useAction(),
    layers = useLayers();
  return (
    <>
      <Field
        label="Nombre de la conexión"
        value={name}
        onChangeText={setName}
        maxLength={40}
      />
      {!!a.error && <Banner type="danger">{a.error}</Banner>}
      <Button
        onPress={() =>
          void a.run(async () => {
            await store.rename(c.id, name);
            layers.close();
          })
        }
      >
        Guardar nombre
      </Button>
      <Button
        variant="danger"
        onPress={() =>
          layers.open({
            kind: "dialog",
            title: "¿Revocar conexión?",
            content: (
              <Confirm
                message="Las siguientes acciones ficticias se bloquearán. Se conserva la actividad anterior."
                run={() => store.revoke(c.id)}
              />
            ),
          })
        }
      >
        Revocar conexión
      </Button>
    </>
  );
}
export function MyAiActivity() {
  const { store, state } = useConnector();
  return (
    <Screen>
      <StudioBar title="Qué hizo tu IA" onBack={() => router.back()} />
      <PageScroll>
        <Ready>
          {state.ready && (
            <>
              <Text kind="meta">
                Actividad de tu usuario en esta organización. Sin mensajes ni
                datos de clientes.
              </Text>
              {!store.ownActivity().length && (
                <EmptyState
                  title="Sin actividad"
                  message="Las acciones ficticias aparecerán aquí."
                />
              )}
              {state.ready &&
                store.ownActivity().map((a) => (
                  <Card key={a.id}>
                    <Text>{actionLabels[a.kind]}</Text>
                    <Text kind="meta">
                      {new Date(a.at).toLocaleString("es-MX")} · Simulación
                    </Text>
                  </Card>
                ))}
            </>
          )}
        </Ready>
      </PageScroll>
    </Screen>
  );
}
export function ConnectorLab() {
  const { store, state } = useConnector(),
    a = useAction(),
    key = useRef(catalogKey());
  return (
    <Screen>
      <StudioBar title="Laboratorio de Mi IA" onBack={() => router.back()} />
      <PageScroll>
        <Ready>
          {state.ready && (
            <>
              <Banner>
                Solo evalúa permisos y registra propuestas ficticias. No ejecuta
                tareas, mensajes, exportaciones, campañas ni IA real.
              </Banner>
              <Text>
                Acciones ficticias hoy: {store.usedToday()} /{" "}
                {state.doc.policy.dailyLimit}
              </Text>
              {!!a.error && <Banner type="danger">{a.error}</Banner>}
              {!store.ownConnections().length && (
                <EmptyState
                  title="Sin conexiones"
                  message="Autoriza una muestra desde Mi IA."
                />
              )}
              {store.ownConnections().map((c) => (
                <Card key={c.id}>
                  <Text>
                    {c.provider} · {c.name}
                  </Text>
                  {!!store.reason(c.id) && <Text>{store.reason(c.id)}</Text>}
                  {kinds.map((kind) => (
                    <Button
                      key={kind}
                      variant="secondary"
                      onPress={() =>
                        void a.run(async () => {
                          await store.simulate(c.id, kind, key.current);
                          key.current = catalogKey();
                        })
                      }
                    >
                      {actionLabels[kind]}
                    </Button>
                  ))}
                </Card>
              ))}
              <NavRow label="Mi IA" onPress={() => router.push("/my-ai")} />
              <NavRow
                label="Actividad reciente"
                onPress={() => router.push("/my-ai-activity")}
              />
            </>
          )}
        </Ready>
      </PageScroll>
    </Screen>
  );
}
