import React, { useEffect, useCallback, useRef, useState } from "react";
import { View, ScrollView } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Gauge } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Section,
  Skeleton,
  Text,
} from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { useSession } from "../../state/SessionProvider";
import { canAccess } from "../../domain/access";
import { useLayers } from "../../components/Layers";
import { useInbox, useInboxState } from "../inbox/store";
import { useStudio, useStudioAction } from "../studio/hooks";
import { StudioBar } from "../studio/StudioBar";
import type { StudioStore } from "../studio/core";
import { studioKey } from "../studio/core";
import {
  demoPlans,
  percentage,
  type PlanId,
  type UsageScenario,
} from "../studio/usage-model";
export function OwnerUsageGate({ children }: React.PropsWithChildren) {
  const { session, disabled } = useSession();
  return !session ||
    session.role !== "owner" ||
    !canAccess(session.role, "more", disabled) ? (
    <EmptyState
      title="Acceso no permitido"
      message="Uso y plan requiere perfil Propietario."
    />
  ) : (
    <>{children}</>
  );
}
export function UsageScreen() {
  return (
    <Screen>
      <OwnerUsageGate>
        <UsageEntry />
      </OwnerUsageGate>
    </Screen>
  );
}
function UsageEntry() {
  const { store, state } = useStudio();
  useEffect(() => {
    void store.library.hydrate();
  }, [store]);
  if (!state.ready)
    return state.error ? (
      <ErrorState onRetry={() => void store.library.hydrate()} />
    ) : (
      <Skeleton rows={4} />
    );
  return <UsageView />;
}
function UsageView() {
  const { store } = useStudio(),
    s = store.usageStats(),
    inbox = useInbox(),
    status = useInboxState().status,
    { colors: c } = useTheme(),
    month = new Date(`${s.data.period}-15T12:00:00Z`).toLocaleDateString(
      "es-MX",
      { month: "long", timeZone: "UTC" },
    ),
    plan = demoPlans.find((p) => p.id === s.data.plan)!;
  return (
    <>
      <UsagePromptBridge />
      <StudioBar
        title="Uso y plan"
        subtitle={`Plan ${plan.name} · ${month}`}
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/more")
        }
      />
      {status === "offline" && (
        <Banner type="warning">Sin conexión · consumo ficticio local.</Banner>
      )}
      <ScrollView
        testID="usage-scroll"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
      >
        {status === "loading" ? (
          <Skeleton rows={4} />
        ) : status === "error" ? (
          <ErrorState
            onRetry={() => {
              inbox.reload();
              inbox.patch({ status: "normal" });
            }}
          />
        ) : status === "empty" ? (
          <EmptyState
            icon={Gauge}
            title="Aún no hay consumo"
            message="El consumo de demostración aparecerá aquí."
          />
        ) : (
          <>
            {s.aiPercent >= 80 && (
              <View
                style={{
                  padding: 12,
                  borderRadius: 12,
                  backgroundColor: c.base,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Gauge size={20} color={c.warning} />
                <Text kind="secondary" style={{ flex: 1, color: c.warning }}>
                  Llevas {s.aiPercent} % de tu IA del mes. Al 100 % la IA se
                  pausa.
                </Text>
                <Button variant="ghost" onPress={() => router.push("/plans")}>
                  Mejorar
                </Button>
              </View>
            )}
            <Meter
              label="IA del mes"
              pct={s.aiPercent}
              sub={`Agentes ${percentage(s.data.used.agents, s.data.limit)} % · Creador ${percentage(s.data.used.creator, s.data.limit)} % · Asistente ${percentage(s.data.used.assistant, s.data.limit)} %`}
              warn={s.aiPercent >= 80}
            />
            <Meter
              label="Almacenamiento (aprox.)"
              pct={percentage(s.storageBytes, s.storageLimit)}
              sub={`${s.storageBytes >= 1e9 ? `${(s.storageBytes / 1e9).toFixed(2)} GB` : `${(s.storageBytes / 1e6).toFixed(2)} MB`} de 5 GB`}
            />
            <Meter
              label="Personas"
              pct={percentage(s.people, s.peopleLimit)}
              sub={`${s.people} de ${s.peopleLimit} personas`}
            />
            <Meter
              label="Documentos de la IA"
              pct={percentage(s.documents, s.documentLimit)}
              sub={`${s.documents} de ${s.documentLimit}`}
            />
            <Section>Por función</Section>
            <Card>
              <Metric
                label="Agentes"
                value={`${percentage(s.data.used.agents, s.data.limit)} %`}
              />
              <Metric
                label="Creador"
                value={`${percentage(s.data.used.creator, s.data.limit)} %`}
              />
              <Metric
                label="Asistente"
                value={`${percentage(s.data.used.assistant, s.data.limit)} %`}
              />
            </Card>
            <Section>Por agente</Section>
            <Card>
              {s.agentUsage.map((a) => (
                <Metric
                  key={a.id}
                  label={a.name}
                  value={`${percentage(a.used, s.data.limit)} %`}
                />
              ))}
            </Card>
            <Button onPress={() => router.push("/plans")}>
              Mejora tu plan
            </Button>
          </>
        )}
      </ScrollView>
    </>
  );
}
function Meter({
  label,
  pct,
  sub,
  warn = false,
}: {
  label: string;
  pct: number;
  sub: string;
  warn?: boolean;
}) {
  const { colors: c } = useTheme();
  return (
    <Card>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text weight="medium" style={{ flex: 1 }}>
          {label}
        </Text>
        <Text weight="medium">{pct} %</Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={`${label}: ${pct} por ciento`}
        accessibilityValue={{ min: 0, max: 100, now: Math.min(100, pct) }}
        style={{ height: 6, borderRadius: 4, backgroundColor: c.sunken }}
      >
        <View
          style={{
            height: 6,
            width: `${Math.min(100, Math.max(0, pct))}%`,
            borderRadius: 4,
            backgroundColor: warn ? c.warning : c.accent,
          }}
        />
      </View>
      <Text kind="meta">{sub}</Text>
    </Card>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 12,
        paddingVertical: 5,
      }}
    >
      <Text kind="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text kind="secondary">{value}</Text>
    </View>
  );
}
export function PlansScreen() {
  return (
    <Screen>
      <OwnerUsageGate>
        <PlansEntry />
      </OwnerUsageGate>
    </Screen>
  );
}
function PlansEntry() {
  const { store, state } = useStudio(),
    layers = useLayers(),
    { colors: c } = useTheme();
  useEffect(() => {
    void store.library.hydrate();
  }, [store]);
  if (!state.ready)
    return state.error ? (
      <ErrorState onRetry={() => void store.library.hydrate()} />
    ) : (
      <Skeleton rows={3} />
    );
  const data = store.usageData();
  return (
    <>
      <StudioBar
        title="Mejora tu plan"
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/usage")
        }
      />
      <ScrollView
        testID="plans-scroll"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
      >
        <Text kind="secondary">
          Precios por mes + IVA. Pago anual: paga 10 meses, usa 12.
        </Text>
        {demoPlans.map((p) => (
          <Card
            key={p.id}
            style={
              p.id === data.plan
                ? { borderColor: c.accent, borderWidth: 2 }
                : undefined
            }
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Text kind="title" weight="semibold">
                {p.name}
              </Text>
              {p.id === data.plan && (
                <Text kind="meta" style={{ color: c.success }}>
                  Tu plan
                </Text>
              )}
              <Text
                weight="semibold"
                style={{ marginLeft: "auto", fontSize: 20 }}
              >
                {new Intl.NumberFormat("es-MX", {
                  style: "currency",
                  currency: "MXN",
                  maximumFractionDigits: 0,
                }).format(p.monthlyCents / 100)}
              </Text>
            </View>
            <Text kind="meta">{p.features}</Text>
            {p.id !== data.plan && (
              <Button
                variant={p.id === "ultra" ? "primary" : "tonal"}
                onPress={() =>
                  layers.open({
                    kind: "dialog",
                    title: `Solicitar plan ${p.name}`,
                    content: <RequestPlanDialog store={store} plan={p.id} />,
                  })
                }
              >{`Solicitar ${p.name}`}</Button>
            )}
            {data.requests.some((r) => r.plan === p.id) && (
              <Text kind="meta">Solicitud local guardada</Text>
            )}
          </Card>
        ))}
      </ScrollView>
    </>
  );
}
export function RequestPlanDialog({
  store,
  plan,
}: {
  store: StudioStore;
  plan: PlanId;
}) {
  const action = useStudioAction(),
    key = useRef(studioKey()),
    { close, toast } = useLayers();
  return (
    <>
      <Text>
        Esta solicitud se guardará solo en la demostración. No se contacta a
        Demfort, no cambia tu suscripción y no se hace ningún cobro.
      </Text>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" disabled={action.pending} onPress={close}>
            Cancelar
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            disabled={action.pending}
            onPress={() =>
              void action.run(async () => {
                await store.requestPlan(plan, key.current);
                close();
                toast("Solicitud guardada solo en la simulación");
              })
            }
          >
            Solicitar
          </Button>
        </View>
      </View>
    </>
  );
}
export function UsagePromptBridge() {
  const { store } = useStudio(),
    { open, toast } = useLayers();
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void store.library
        .hydrate()
        .then(async () => {
          if (
            !active ||
            !store.library.snapshot().ready ||
            !store.usageShouldPrompt()
          )
            return;
          const claimed = await store.usageClaimPrompt();
          if (active && claimed === "show")
            open({
              kind: "dialog",
              title: "Vas a este ritmo",
              content: <UsagePaceDialog store={store} />,
            });
        })
        .catch(() => {
          if (active)
            toast(
              "No se pudo guardar el aviso local. Reintenta al volver a Uso y plan.",
            );
        });
      return () => {
        active = false;
      };
    }, [store, open, toast]),
  );
  return null;
}
export function UsagePaceDialog({ store }: { store: StudioStore }) {
  const { close } = useLayers(),
    action = useStudioAction(),
    day = store.usageStats().projectedDay;
  return (
    <>
      <Text>
        Con tu consumo actual, tu IA del mes se agotará hacia el día{" "}
        {day ?? "—"}.
      </Text>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button
        onPress={() => {
          close();
          router.push("/plans");
        }}
      >
        Ver planes
      </Button>
      <Button
        variant="ghost"
        disabled={action.pending}
        onPress={() =>
          void action.run(async () => {
            await store.usageSnooze();
            close();
          })
        }
      >
        Recordármelo en 3 días
      </Button>
    </>
  );
}
export function AssistantLimit({ store }: { store: StudioStore }) {
  const { colors: c } = useTheme(),
    s = store.usageStats(),
    date = new Date(
      Date.UTC(
        Number(s.data.period.slice(0, 4)),
        Number(s.data.period.slice(5, 7)),
        1,
      ),
    ),
    renewal = date.toLocaleDateString("es-MX", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
  return (
    <>
      <StudioBar
        title="Asistente"
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/more")
        }
      />
      <ScrollView
        contentContainerStyle={{
          padding: 32,
          paddingTop: 44,
          alignItems: "center",
          gap: 10,
        }}
      >
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: 26,
            backgroundColor: c.wash,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 6,
          }}
        >
          <Gauge size={34} color={c.accentInk} />
        </View>
        <Text kind="title" weight="semibold" style={{ textAlign: "center" }}>
          {s.data.assistantLimit === 0
            ? "El asistente no tiene un tope configurado"
            : "El asistente alcanzó su tope"}
        </Text>
        <Text kind="secondary" style={{ textAlign: "center", color: c.text3 }}>
          Se renueva el {renewal}. Puedes pedir más crédito en Mejora tu plan.
        </Text>
        <Button onPress={() => router.push("/plans")}>Mejora tu plan</Button>
      </ScrollView>
    </>
  );
}
export function UsageLabScreen() {
  return (
    <Screen>
      <OwnerUsageGate>
        <UsageLab />
      </OwnerUsageGate>
    </Screen>
  );
}
function UsageLab() {
  const { store, state } = useStudio(),
    action = useStudioAction();
  useEffect(() => {
    void store.library.hydrate();
  }, [store]);
  if (!state.ready) return <Skeleton rows={3} />;
  const scenarios: readonly [UsageScenario, string][] = [
    ["normal", "Normal · IA 42 % / Asistente 34 %"],
    ["warning", "Aviso · IA 80 %"],
    ["assistant-blocked", "Asistente al tope"],
    ["organization-blocked", "Organización al tope"],
    ["no-assistant-limit", "Asistente sin tope configurado"],
  ];
  return (
    <>
      <StudioBar
        title="Laboratorio · Uso y plan"
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Banner>
          Datos ficticios. No se realizan pagos, cambios de plan ni consumos
          reales.
        </Banner>
        {scenarios.map(([id, label]) => (
          <Button
            key={id}
            variant="secondary"
            disabled={action.pending}
            onPress={() => void action.run(() => store.usageScenario(id))}
          >
            {label}
          </Button>
        ))}
        {!!action.error && <Banner type="danger">{action.error}</Banner>}
        <Button onPress={() => router.push("/usage")}>Abrir Uso y plan</Button>
        <Button variant="tonal" onPress={() => router.push("/assistant")}>
          Abrir Asistente
        </Button>
      </ScrollView>
    </>
  );
}
