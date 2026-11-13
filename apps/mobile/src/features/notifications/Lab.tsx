import React, { useState } from "react";
import { router } from "expo-router";
import { Screen } from "../../components/Screen";
import {
  AppBar,
  Banner,
  Button,
  Card,
  PageScroll,
  Section,
  Text,
} from "../../components/ui";
import { useNotifications, useNotificationState } from "./context";
import { DemoNotificationBackend } from "./adapters/demo";
import { ORG_A, ORG_B, type Kind } from "./model";
let counter = 0;
export function NotificationLab() {
  const store = useNotifications(),
    s = useNotificationState(store),
    backend = store.backend as DemoNotificationBackend;
  const [latest, setLatest] = useState<ReturnType<
      typeof backend.publish
    > | null>(null),
    [error, setError] = useState("");
  const run = (fn: () => unknown) => {
    void Promise.resolve()
      .then(fn)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Error ficticio"),
      );
  };
  const publish = (
    kind: Kind = "message.incoming",
    options: { expired?: boolean; org?: string; conversation?: string } = {},
  ) => {
    const now = Date.now(),
      e = backend.publish({
        eventId: `demo-event-${now}-${++counter}`,
        kind,
        organizationId: options.org ?? s.identity?.organizationId ?? ORG_A,
        conversationId:
          options.conversation ??
          (s.identity?.organizationId === ORG_B
            ? "demo-b-conv-1"
            : s.identity?.userId === "demo-advisor"
              ? "demo-conv-3"
              : "demo-conv-1"),
        occurredAt: now - (options.expired ? 7200000 : 0),
        expiresAt: now + (options.expired ? -3600000 : 3600000),
      });
    setLatest(e);
    return store.receive(e);
  };
  return (
    <Screen>
      <AppBar
        title="Simulación de avisos"
        onBack={() => router.replace("/demo")}
      />
      <PageScroll>
        <Banner>
          QA T-M5A · Solo memoria y almacenamiento de demo. No pide permisos ni
          emite avisos del sistema.
        </Banner>
        {!!(error || s.error) && (
          <Banner type="danger">{error || s.error}</Banner>
        )}
        <Card>
          <Text>
            Sesión:{" "}
            {s.identity
              ? `${s.identity.userId} · ${s.identity.organizationId}`
              : "Sin sesión ficticia"}
          </Text>
          <Text>Permiso simulado: {s.permission}</Text>
          <Text>
            Registro ficticio: {s.registered ? "activo" : "inactivo"} ·
            Revocación pendiente: {s.revocationPending ? "sí" : "no"}
          </Text>
          <Text>
            Conexión simulada: {s.online ? "en línea" : "sin conexión"} · Primer
            plano: {s.foreground ? "sí" : "no"}
          </Text>
          <Text>
            Cursor: {s.cursor} · Eventos conocidos: {s.seen.length}
          </Text>
          <Text accessibilityLiveRegion="polite">{s.result}</Text>
        </Card>
        <Section>Permisos y registro ficticios</Section>
        <Button onPress={() => store.permission("granted")}>
          Conceder permiso ficticio
        </Button>
        <Button variant="secondary" onPress={() => store.permission("denied")}>
          Denegar permiso ficticio
        </Button>
        <Button variant="secondary" onPress={() => store.permission("revoked")}>
          Revocar permiso ficticio
        </Button>
        <Button variant="secondary" onPress={store.rotate}>
          Renovar token ficticio
        </Button>
        <Section>Eventos ficticios</Section>
        <Button onPress={() => run(() => publish())}>
          Simular mensaje entrante
        </Button>
        <Button
          variant="secondary"
          onPress={() => run(() => publish("handoff"))}
        >
          Simular handoff
        </Button>
        <Button
          variant="secondary"
          onPress={() => run(() => latest && store.receive(latest))}
        >
          Repetir último evento
        </Button>
        <Button
          variant="secondary"
          onPress={() => run(() => publish("message.outgoing"))}
        >
          Simular mensaje saliente
        </Button>
        <Button
          variant="secondary"
          onPress={() =>
            run(() => publish("message.incoming", { expired: true }))
          }
        >
          Simular evento caducado
        </Button>
        <Button
          variant="secondary"
          onPress={() =>
            run(() =>
              publish("message.incoming", {
                org: ORG_B,
                conversation: "demo-b-conv-1",
              }),
            )
          }
        >
          Simular evento de otra organización
        </Button>
        <Section>Avisos lógicos</Section>
        <Text>Grupos de conversación: {s.groups.length}</Text>
        {s.groups.map((g) => (
          <Card key={g.key}>
            <Text weight="semibold">{g.title}</Text>
            <Text>{g.body}</Text>
            <Button
              variant="secondary"
              onPress={() =>
                run(() => store.tap(backend.known(s.identity!, g.eventId)))
              }
            >
              Abrir aviso ficticio
            </Button>
          </Card>
        ))}
        <Button
          variant="secondary"
          onPress={() => run(() => latest && store.tap(latest))}
        >
          Tocar último aviso ficticio
        </Button>
        <Button
          variant="secondary"
          onPress={() => run(() => store.openPending())}
        >
          Reintentar destino pendiente
        </Button>
        <Text>Destino pendiente: {s.pending ? "sí" : "no"}</Text>
        <Section>Recuperación</Section>
        <Button
          variant="secondary"
          onPress={() => run(() => store.connection(!s.online))}
        >
          {s.online ? "Desconectar simulación" : "Reconectar simulación"}
        </Button>
        <Button
          variant="secondary"
          onPress={() => run(() => store.foreground(!s.foreground))}
        >
          {s.foreground
            ? "Simular segundo plano"
            : "Simular regreso a primer plano"}
        </Button>
        <Button onPress={() => run(() => store.sync())}>
          Sincronizar muestra
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            backend.failNextSync = true;
          }}
        >
          Fallar próxima sincronización
        </Button>
        <Section>Identidad de notificaciones</Section>
        <Text>
          Estos controles no cambian la sesión de acceso de T-M1. Bandeja sigue
          siendo la demo de organización A; un destino B nunca se abre sobre
          ella.
        </Text>
        <Button variant="secondary" onPress={() => store.identity(null)}>
          Cerrar sesión de notificaciones
        </Button>
        <Button
          variant="secondary"
          onPress={() =>
            run(() => {
              if (!s.identity)
                throw Error("Entra primero con un perfil ficticio en /demo.");
              store.identity({
                ...s.identity,
                organizationId:
                  s.identity.organizationId === ORG_A ? ORG_B : ORG_A,
              });
            })
          }
        >
          Cambiar organización ficticia
        </Button>
        <Button
          variant="secondary"
          onPress={() =>
            run(() => {
              if (s.identity)
                backend.setMembership(
                  s.identity.organizationId,
                  s.identity.userId,
                  false,
                );
              return store.sync();
            })
          }
        >
          Simular pérdida de pertenencia
        </Button>
        <Button
          variant="secondary"
          onPress={() =>
            run(() => {
              if (s.identity)
                backend.setMembership(
                  s.identity.organizationId,
                  s.identity.userId,
                  true,
                );
              return store.sync();
            })
          }
        >
          Restaurar pertenencia ficticia
        </Button>
      </PageScroll>
    </Screen>
  );
}
