import { KeyboardScrollView as ScrollView } from "../keyboard/KeyboardScrollView";
import React, {
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { View, Pressable } from "react-native";
import { router } from "expo-router";
import { SlidersHorizontal, ChartColumn } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  AppBar,
  IconButton,
  SegmentedControl,
  FilterChips,
} from "../../components/ModuleUi";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  PickerRow,
  Section,
  Skeleton,
  Text,
} from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { useLayers } from "../../components/Layers";
import { useSession } from "../../state/SessionProvider";
import { canAccess } from "../../domain/access";
import { useInbox, useInboxState } from "../inbox/store";
import { personName } from "../contact/model";
import { ResultsStore, resultsTeam, type ResultsState } from "./core";
const stores = new WeakMap<object, ResultsStore>();
export function resultsFor(inbox: { actor: ResultsStore["actor"] }) {
  let m = stores.get(inbox);
  if (!m) {
    m = new ResultsStore(inbox.actor);
    stores.set(inbox, m);
  }
  return m;
}
const cash = (cents: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(cents / 100);
export function ResultsScreen() {
  const inbox = useInbox(),
    store = resultsFor(inbox),
    { session, disabled } = useSession();
  if (!session || !canAccess(session.role, "more", disabled) || !store.canRead)
    return (
      <Screen>
        <AppBar title="Resultados" onBack={() => router.back()} />
        <EmptyState
          title="Acceso no permitido"
          message="Tu perfil no tiene permiso para ver Resultados."
        />
      </Screen>
    );
  return (
    <Screen>
      <ResultsView store={store} />
    </Screen>
  );
}
function ResultsView({ store }: { store: ResultsStore }) {
  const s = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    inbox = useInboxState(),
    { open } = useLayers(),
    { colors: c } = useTheme(),
    scroll = useRef<React.ComponentRef<typeof ScrollView>>(null),
    restoring = useRef(true);
  useEffect(() => {
    store.status(inbox.status);
  }, [store, inbox.status]);
  useLayoutEffect(() => {
    restoring.current = true;
    const y = store.offset();
    let second: number | undefined;
    const first = requestAnimationFrame(() => {
      scroll.current?.scrollTo({ y, animated: false });
      second = requestAnimationFrame(() => {
        scroll.current?.scrollTo({ y, animated: false });
        restoring.current = false;
      });
    });
    return () => {
      restoring.current = true;
      cancelAnimationFrame(first);
      if (second !== undefined) cancelAnimationFrame(second);
    };
  }, [store, s.tab]);

  const m = useMemo(() => store.summary(), [store, s.query, s.status]),
    previous = useMemo(() => store.comparison(), [store, s.query]);
  const pct = (now: number, before: number) =>
    before
      ? `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)} %`
      : undefined;
  const ranges = [
    ["7", "7 días"],
    ["30", "30 días"],
    ["month", "Este mes"],
  ] as const;
  const rows: readonly (readonly [string, string, string?])[] =
    s.tab === "sales"
      ? [
          ["Dinero ganado", cash(m.money), pct(m.money, previous.money)],
          ["Tratos ganados", String(m.won)],
          ["Tasa de cierre", `${m.closeRate} %`],
          ["Ticket promedio", cash(m.averageTicket)],
          ["En tratos abiertos", cash(m.openMoney)],
          [
            "Prospectos nuevos",
            String(m.prospects),
            pct(m.prospects, previous.prospects),
          ],
        ]
      : s.tab === "care"
        ? [
            ["Contestó el agente", String(m.ai)],
            ["Pasaron a un humano", String(m.handoffs)],
            [
              "Primera respuesta",
              m.responseSeconds === null
                ? "—"
                : m.responseSeconds >= 60
                  ? `${Math.round(m.responseSeconds / 60)} min`
                  : `${m.responseSeconds} s`,
            ],
            [
              "Asistencia a citas",
              m.attendance === null ? "—" : `${m.attendance} %`,
            ],
          ]
        : [
            ["Llegaron por un anuncio", String(m.ads)],
            ["No llegaron por anuncio", String(m.organic)],
          ];
  return (
    <>
      <AppBar
        title="Resultados"
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/more")
        }
        actions={
          <IconButton
            icon={SlidersHorizontal}
            label="Periodo y asesor"
            onPress={() =>
              open({
                kind: "sheet",
                title: "Periodo y asesor",
                content: <PeriodForm store={store} />,
              })
            }
          />
        }
      />
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        <SegmentedControl
          options={[
            { key: "sales", label: "Ventas" },
            { key: "care", label: "Atención" },
            { key: "origin", label: "Origen" },
          ]}
          value={s.tab}
          onChange={(v) => store.tab(v as ResultsState["tab"])}
        />
      </View>
      {s.status === "offline" && (
        <Banner type="warning">
          Sin conexión · datos locales de demostración.
        </Banner>
      )}
      <ScrollView
        ref={scroll}
        testID="results-scroll"
        onScroll={(e) => {
          if (!restoring.current)
            store.rememberOffset(e.nativeEvent.contentOffset.y);
        }}
        scrollEventThrottle={100}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View
          style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}
        >
          <View
            style={{
              flexDirection: "row",
              padding: 3,
              borderRadius: 12,
              backgroundColor: c.sunken,
              gap: 4,
            }}
          >
            {ranges.map(([key, label]) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: s.period === key }}
                aria-pressed={s.period === key}
                onPress={() => store.period(key)}
                style={{
                  flex: 1,
                  minHeight: 44,
                  justifyContent: "center",
                  alignItems: "center",
                  borderRadius: 10,
                  backgroundColor: s.period === key ? c.surface : "transparent",
                }}
              >
                <Text
                  kind="secondary"
                  weight={s.period === key ? "semibold" : "medium"}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          {(s.period === "custom" || s.query.assignee) && (
            <Text kind="meta">
              {s.query.from} — {s.query.to}
              {s.query.assignee ? ` · ${personName(s.query.assignee)}` : ""}
            </Text>
          )}
        </View>
        {s.status === "loading" ? (
          <Skeleton rows={4} />
        ) : s.status === "error" ? (
          <ErrorState onRetry={() => store.status("normal")} />
        ) : !m.prospects && !m.ai && !m.appointments ? (
          <EmptyState
            icon={ChartColumn}
            title="Aún no hay datos"
            message="Cuando haya chats y tratos en el periodo, verás aquí tus números."
          />
        ) : (
          <>
            <View
              style={{
                paddingHorizontal: 16,
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              {rows.map(([label, value, trend]) => (
                <View
                  key={label}
                  style={{
                    width: "48%",
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 16,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    gap: 2,
                  }}
                >
                  <Text kind="capsule" style={{ color: c.text3 }}>
                    {label}
                  </Text>
                  <Text
                    weight="semibold"
                    style={{ fontSize: 22, lineHeight: 27 }}
                  >
                    {value}
                  </Text>
                  {trend && (
                    <Text
                      kind="meta"
                      style={{
                        color: trend.startsWith("-") ? c.danger : c.success,
                      }}
                    >
                      {trend}
                    </Text>
                  )}
                </View>
              ))}
            </View>
            <View style={{ paddingHorizontal: 16 }}>
              {s.tab === "sales" ? (
                <>
                  <Section>Embudo</Section>
                  <Card>
                    {[
                      ["Nuevos", m.prospects],
                      ["En conversación", m.conversations],
                      ["Interesados", m.interested],
                      ["Clientes", m.won],
                    ].map(([label, value]) => (
                      <View
                        key={label}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          paddingVertical: 3,
                        }}
                      >
                        <Text kind="secondary" style={{ width: 96 }}>
                          {label}
                        </Text>
                        <View style={{ flex: 1 }}>
                          <View
                            style={{
                              width: `${m.prospects ? Math.min(100, (Number(value) / m.prospects) * 100) : 0}%`,
                              minWidth: 34,
                              height: 26,
                              borderRadius: 7,
                              backgroundColor: c.accent,
                              justifyContent: "center",
                              paddingHorizontal: 9,
                            }}
                          >
                            <Text
                              kind="capsule"
                              weight="semibold"
                              style={{ color: c.onAccent }}
                            >
                              {value}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </Card>
                  <Section>Qué se está cayendo</Section>
                  <Card>
                    <Metric label="Tratos perdidos" value={String(m.lost)} />
                    <Metric
                      label="Tratos sin monto"
                      value={String(m.missingAmount)}
                    />
                    <Metric
                      label="Chats sin respuesta (+24 h)"
                      value={String(m.unanswered)}
                    />
                  </Card>
                </>
              ) : s.tab === "care" ? (
                <>
                  <Section>Citas</Section>
                  <Card>
                    <Metric label="Realizadas" value={String(m.appointments)} />
                    <Metric
                      label="Canceladas"
                      value={String(m.cancellations)}
                    />
                  </Card>
                </>
              ) : (
                <>
                  <Section>Anuncios</Section>
                  <Card>
                    {m.campaigns.map((a) => (
                      <Metric
                        key={a.name}
                        label={a.name}
                        value={`${a.chats} chats · ${a.sales} ventas`}
                      />
                    ))}
                  </Card>
                  <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                    <Text kind="meta">
                      Atribución simulada. No se reportan eventos a Meta.
                    </Text>
                  </View>
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingVertical: 8 }}>
      <Text kind="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text kind="secondary" style={{ flex: 1, textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}
function PeriodForm({ store }: { store: ResultsStore }) {
  const q = store.snapshot().query,
    [from, setFrom] = useState(q.from),
    [to, setTo] = useState(q.to),
    [assignee, setAssignee] = useState(q.assignee),
    [expanded, setExpanded] = useState(""),
    [error, setError] = useState(""),
    { close } = useLayers();
  const apply = () => {
    try {
      store.apply({ from, to, assignee });
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <PickerRow
        label="Desde"
        value={from}
        onPress={() => setExpanded(expanded === "from" ? "" : "from")}
      />
      {expanded === "from" && (
        <Field
          label="Desde · AAAA-MM-DD"
          value={from}
          onChangeText={setFrom}
          maxLength={10}
          keyboardType="numbers-and-punctuation"
        />
      )}
      <PickerRow
        label="Hasta"
        value={to}
        onPress={() => setExpanded(expanded === "to" ? "" : "to")}
      />
      {expanded === "to" && (
        <Field
          label="Hasta · AAAA-MM-DD"
          value={to}
          onChangeText={setTo}
          maxLength={10}
          keyboardType="numbers-and-punctuation"
        />
      )}
      <Section>Asesor</Section>
      <FilterChips
        options={["Todos los asesores", ...resultsTeam.map(personName)]}
        value={assignee ? personName(assignee) : "Todos los asesores"}
        onChange={(v) =>
          setAssignee(resultsTeam.find((id) => personName(id) === v) ?? null)
        }
      />
      {!!error && <Banner type="danger">{error}</Banner>}
      <Button onPress={apply}>Aplicar</Button>
    </>
  );
}
