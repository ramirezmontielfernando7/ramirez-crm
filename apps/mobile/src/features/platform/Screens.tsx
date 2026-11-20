import { Building2 } from "lucide-react-native";
import React, { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { Screen } from "../../components/Screen";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  NavRow,
  PageScroll,
  Section,
  Skeleton,
  Text,
} from "../../components/ui";
import { StudioBar } from "../studio/StudioBar";
import { SegmentedControl } from "../../components/ModuleUi";
import { usePlatform } from "./state";
function Ready({ children }: React.PropsWithChildren) {
  const { store, state } = usePlatform();
  return !state.allowed ? (
    <EmptyState
      title="Acceso no permitido"
      message="Se requiere un permiso explícito de plataforma. Ser propietario de un negocio no lo concede."
    />
  ) : !state.ready ? (
    state.error ? (
      <ErrorState onRetry={() => void store.hydrate()} />
    ) : (
      <Skeleton rows={4} />
    )
  ) : (
    <>{children}</>
  );
}
function KV({ label, value }: { label: string; value: string | number }) {
  return (
    <View
      style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}
    >
      <Text kind="secondary">{label}</Text>
      <Text weight="medium">{value}</Text>
    </View>
  );
}
export function PlatformPanel() {
  const { state } = usePlatform(),
    rows = state.organizations;
  return (
    <Screen>
      <StudioBar
        title="Plataforma"
        subtitle="Mi panel"
        onBack={() => router.back()}
      />
      <SegmentedControl
        options={[
          { key: "p", label: "Mi panel" },
          { key: "o", label: "Organizaciones" },
        ]}
        value="p"
        onChange={() => router.push("/platform-organizations")}
      />
      <PageScroll>
        <Ready>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {[
              ["Organizaciones", rows.length],
              ["Con aviso de IA", rows.filter((o) => o.ai >= 80).length],
              ["Personas", rows.reduce((s, o) => s + o.people, 0)],
              ["Webhooks sin ruta", 0],
            ].map(([k, v]) => (
              <Card key={k} style={{ width: "47%" }}>
                <Text kind="meta">{k}</Text>
                <Text kind="module" weight="semibold">
                  {v}
                </Text>
              </Card>
            ))}
          </View>
          <Section>Actividad reciente</Section>
          {[
            "Alta de «Unid Campus»",
            "Plan de «Joyería Cristal» → Pro",
            "Enlace de contraseña generado",
          ].map((t) => (
            <Text key={t} style={{ paddingVertical: 12 }}>
              {t}
            </Text>
          ))}
          <Text kind="meta">Metadatos de muestra · Solo lectura</Text>
        </Ready>
      </PageScroll>
    </Screen>
  );
}
export function PlatformOrganizations() {
  const { state } = usePlatform();
  return (
    <Screen>
      <StudioBar
        title="Plataforma"
        subtitle="Organizaciones"
        onBack={() => router.back()}
      />
      <PageScroll>
        <Ready>
          {state.organizations.length ? (
            state.organizations.map((o) => (
              <View key={o.id}>
                <NavRow
                  icon={Building2}
                  label={o.name}
                  onPress={() => router.push(`/platform-detail?id=${o.id}`)}
                />
                <Text kind="meta">{`${o.plan} · ${o.modules} módulos · IA ${o.ai} %${o.ai >= 80 ? " · Cerca del tope" : ""}`}</Text>
              </View>
            ))
          ) : (
            <EmptyState
              title="Sin organizaciones"
              message="No hay metadatos disponibles en esta muestra."
            />
          )}
        </Ready>
      </PageScroll>
    </Screen>
  );
}
export function PlatformDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    { store, state } = usePlatform(),
    [tab, setTab] = useState("a");
  const org =
    state.allowed && state.ready
      ? (() => {
          try {
            return store.organization(id);
          } catch {
            return null;
          }
        })()
      : null;
  return (
    <Screen>
      <StudioBar
        title={org?.name ?? "Ficha de la organización"}
        subtitle={org ? `Plan ${org.plan}` : undefined}
        onBack={() => router.back()}
      />
      <Ready>
        {!org ? (
          <EmptyState
            title="Organización no disponible"
            message="Regresa a la lista de organizaciones ficticias."
          />
        ) : (
          <>
            <SegmentedControl
              options={[
                { key: "a", label: "Plan y módulos" },
                { key: "b", label: "IA y topes" },
                { key: "c", label: "Consumo" },
                { key: "d", label: "Accesos" },
              ]}
              value={tab}
              onChange={setTab}
            />
            <PageScroll>
              <Card>
                {tab === "a" ? (
                  <>
                    <KV label="Plan" value={org.plan} />
                    <KV label="Módulos" value={org.modules} />
                    <KV label="IA este mes" value={`${org.ai} %`} />
                    <KV label="Estado" value={org.state} />
                  </>
                ) : tab === "b" ? (
                  <>
                    <KV label="IA del mes" value={`${org.ai} %`} />
                    <KV label="Tope ficticio" value="100 %" />
                    <KV label="Al alcanzar el tope" value="Pausa simulada" />
                  </>
                ) : tab === "c" ? (
                  <>
                    <KV label="Almacenamiento" value={`${org.storage} %`} />
                    <KV
                      label="Personas"
                      value={`${org.people} de ${org.seats}`}
                    />
                  </>
                ) : (
                  <>
                    <KV label="Estado" value={org.state} />
                    <Text>{org.access}</Text>
                    <Text kind="meta">
                      Sin sesiones, credenciales ni contenido del negocio.
                    </Text>
                  </>
                )}
              </Card>
              <Text kind="secondary">
                Solo lectura en móvil · Datos ficticios
              </Text>
            </PageScroll>
          </>
        )}
      </Ready>
    </Screen>
  );
}
export function PlatformLab() {
  const { store, state } = usePlatform(false);
  return (
    <Screen>
      <StudioBar
        title="Laboratorio de plataforma"
        onBack={() => router.back()}
      />
      <PageScroll>
        <Banner>
          Simulación local. Este permiso es independiente del rol del negocio y
          no concede acceso real.
        </Banner>
        <Button
          onPress={() =>
            store.demoAccess(!state.allowed, "SOLO METADATOS FICTICIOS")
          }
        >
          {state.allowed
            ? "Revocar permiso ficticio"
            : "Confirmar acceso a metadatos ficticios"}
        </Button>
        {state.allowed && (
          <NavRow
            label="Abrir Plataforma"
            onPress={() => router.push("/platform-panel")}
          />
        )}
      </PageScroll>
    </Screen>
  );
}
