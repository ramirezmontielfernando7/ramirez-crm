import { useTheme } from "../../theme/ThemeProvider";
import { useSession } from "../../state/SessionProvider";
import { canAccess } from "../../domain/access";
import React, { useEffect, useRef, useState } from "react";
import { View, FlatList, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  MoreVertical,
  Plus,
  Search,
  Upload,
  Share2,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  AppBar,
  IconButton,
  FilterChips,
  SegmentedControl,
} from "../../components/ModuleUi";
import {
  Avatar,
  Banner,
  Button,
  Card,
  Choice,
  EmptyState,
  ErrorState,
  Field,
  NavRow,
  PageScroll,
  SearchBox,
  Section,
  Skeleton,
  Text,
} from "../../components/ui";
import { StudioBar } from "../studio/StudioBar";
import { useLayers } from "../../components/Layers";
import { catalogKey } from "../catalog/core";
import { variables } from "../templates/core";
import { useMarketing } from "./state";
import { MarketingTabs } from "./Tabs";
import {
  importSamples,
  statusLabels,
  recipientLabels,
  type Input,
  type Campaign,
  type Settings,
  type MarketingStore,
  type Plan,
} from "./core";
const money = (cents: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    cents / 100,
  );
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
  const { store, state } = useMarketing();
  let denied = false;
  try {
    denied = store.team.actor(store.actor).role === "advisor";
  } catch {
    denied = true;
  }
  const { session, disabled } = useSession();
  if (!session || !canAccess(session.role, "marketing", disabled))
    return (
      <EmptyState
        title="Acceso no permitido"
        message="Marketing no está disponible para tu perfil."
        action={
          <Button onPress={() => router.replace("/(tabs)/inbox")}>
            Volver a Bandeja
          </Button>
        }
      />
    );
  return denied ? (
    <EmptyState
      title="Acceso no permitido"
      message="Marketing requiere Propietario o Coordinador."
      action={
        <Button onPress={() => router.replace("/(tabs)/inbox")}>
          Volver a Bandeja
        </Button>
      }
    />
  ) : !state.ready ? (
    state.error ? (
      <ErrorState onRetry={() => void store.reload()} />
    ) : (
      <Skeleton rows={4} />
    )
  ) : (
    <>{children}</>
  );
}
function ErrorBanner({ error }: { error: string }) {
  return error ? <Banner type="danger">{error}</Banner> : null;
}
function Stats({
  rows,
}: {
  rows: readonly (readonly [string, string | number])[];
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {rows.map(([label, value]) => (
        <View key={label} style={{ minWidth: "45%", flexGrow: 1, padding: 12 }}>
          <Text kind="meta">{label}</Text>
          <Text kind="title" weight="semibold">
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}
function RootFab({
  label,
  onPress,
  upload = false,
}: {
  label: string;
  onPress: () => void;
  upload?: boolean;
}) {
  const { colors: c } = useTheme(),
    Icon = upload ? Upload : Plus;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        position: "absolute",
        bottom: 96,
        right: 16,
        width: 56,
        height: 56,
        borderRadius: 18,
        backgroundColor: c.accent,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={24} color={c.onAccent} />
    </Pressable>
  );
}
function Funnel({ rows }: { rows: readonly (readonly [string, number])[] }) {
  const { colors: c } = useTheme(),
    max = Math.max(1, rows[0]?.[1] ?? 1);
  return (
    <Card>
      {rows.map(([label, value]) => (
        <View key={label} style={{ gap: 4, paddingVertical: 6 }}>
          <Text kind="meta">{label}</Text>
          <View
            style={{
              height: 24,
              minWidth: 36,
              width: `${Math.max(4, (value / max) * 100)}%`,
              backgroundColor: c.wash,
              borderRadius: 4,
              paddingHorizontal: 8,
              justifyContent: "center",
            }}
          >
            <Text kind="meta" weight="semibold" style={{ color: c.accentInk }}>
              {value}
            </Text>
          </View>
        </View>
      ))}
    </Card>
  );
}
export function Audiences() {
  const { store, state } = useMarketing(),
    layers = useLayers();
  return (
    <Screen>
      <AppBar module title="Marketing" />
      <MarketingTabs value="audiences" />
      <Ready>
        <Banner>
          Consulta tus bases e importa muestras ficticias. El mapeo completo y
          los archivos reales siguen fuera de esta simulación.
        </Banner>
        <FlatList
          data={state.doc.audiences}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          ListEmptyComponent={
            <EmptyState
              title="Sin bases todavía"
              message="Elige una muestra CSV o XLSX ficticia."
            />
          }
          renderItem={({ item: a }) => (
            <NavRow
              label={`${a.name} · ${a.members.length} contactos`}
              onPress={() => router.push(`/audience-detail?id=${a.id}`)}
            />
          )}
        />
        <RootFab
          label="Subir una base"
          upload
          onPress={() =>
            layers.open({
              kind: "sheet",
              title: "Subir una base",
              content: <ImportForm />,
            })
          }
        />
      </Ready>
    </Screen>
  );
}
function ImportForm() {
  const { store } = useMarketing(),
    layers = useLayers(),
    [sample, setSample] = useState(""),
    [pcol, setPcol] = useState(""),
    [ncol, setNcol] = useState(""),
    [name, setName] = useState("Base noviembre"),
    [consent, setConsent] = useState<boolean | null>(null),
    [choosing, setChoosing] = useState(false),
    a = useAction(),
    key = useRef(catalogKey()),
    f = importSamples.find((f) => f.id === sample);
  return (
    <>
      <Banner>
        Selector simulado: no abre archivos ni contactos del teléfono.
      </Banner>
      <Button variant="secondary" onPress={() => setChoosing(!choosing)}>
        Elegir .xlsx o .csv
      </Button>
      {choosing &&
        importSamples.map((f) => (
          <NavRow
            key={f.id}
            label={f.name}
            onPress={() => {
              setSample(f.id);
              setPcol("");
              setNcol("");
              setChoosing(false);
            }}
          />
        ))}
      {!!f && (
        <>
          <Text>
            Muestra: {f.name} · {f.rows.length} filas
          </Text>
          <Section>Columna de teléfono</Section>
          {f.columns.map((c) => (
            <Choice
              radio
              key={c}
              label={`Teléfono: ${c}`}
              checked={pcol === c}
              onPress={() => setPcol(c)}
            />
          ))}
          <Section>Columna de nombre</Section>
          {f.columns.map((c) => (
            <Choice
              radio
              key={c}
              label={`Nombre: ${c}`}
              checked={ncol === c}
              onPress={() => setNcol(c)}
            />
          ))}
        </>
      )}
      <Field
        label="Nombre de la base"
        value={name}
        onChangeText={setName}
        maxLength={80}
      />
      <Section>¿Aceptaron recibir mensajes?</Section>
      <Choice
        radio
        label="Sí (opt-in)"
        checked={consent === true}
        onPress={() => setConsent(true)}
      />
      <Choice
        radio
        label="No / no lo sé"
        checked={consent === false}
        onPress={() => setConsent(false)}
      />
      <ErrorBanner error={a.error} />
      <Button variant="secondary" onPress={layers.close}>
        Cancelar
      </Button>
      <Button
        onPress={() =>
          void a.run(async () => {
            if (consent === null) throw Error("Indica si existe opt-in.");
            const id = await store.importFile(
              sample,
              name,
              consent,
              pcol,
              ncol,
              key.current,
            );
            layers.close();
            router.push(`/audience-detail?id=${id}`);
          })
        }
      >
        Importar
      </Button>
    </>
  );
}
export function AudienceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Screen>
      <Ready>
        <AudienceBody key={id} id={id} />
      </Ready>
    </Screen>
  );
}
function AudienceBody({ id }: { id: string }) {
  const { store } = useMarketing(),
    a = useAction();
  let base;
  try {
    base = store.audience(id);
  } catch {
    return (
      <EmptyState
        title="Base no disponible"
        message="Regresa a Audiencias."
        action={
          <Button
            onPress={() =>
              router.replace("/(tabs)/marketing?section=audiences")
            }
          >
            Audiencias
          </Button>
        }
      />
    );
  }
  return (
    <>
      <StudioBar title={base.name} onBack={() => router.back()} />
      <PageScroll>
        <Stats
          rows={[
            ["Creados", base.created],
            ["Actualizados", base.updated],
            ["Duplicados", base.duplicates],
            ["Inválidos", base.invalid],
          ]}
        />
        <Section>Líneas con problema</Section>
        {base.issues.length ? (
          <Card>
            {base.issues.map((i) => (
              <Text key={i.line}>
                Línea {i.line} · {i.reason}
              </Text>
            ))}
          </Card>
        ) : (
          <Text>Sin líneas con problema.</Text>
        )}
        <Text kind="meta">
          El opt-in se revalida con las bajas y la frecuencia antes de confirmar
          y avanzar cada simulación.
        </Text>
        <ErrorBanner error={a.error} />
        <Button
          onPress={() =>
            void a.run(async () => {
              const c = await store.start(id, catalogKey());
              router.push(`/campaign-new?id=${c}`);
            })
          }
        >
          Crear campaña con esta base
        </Button>
      </PageScroll>
    </>
  );
}
export function CampaignList() {
  const { store, state } = useMarketing(),
    [filter, setFilter] = useState("Todas"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(false),
    layers = useLayers(),
    a = useAction();
  const create = () =>
    void a.run(async () => {
      const id = await store.start(undefined, catalogKey());
      router.push(`/campaign-new?id=${id}`);
    });
  return (
    <Screen>
      <AppBar
        module
        title="Marketing"
        actions={
          <>
            <IconButton
              icon={Search}
              label="Buscar campaña"
              onPress={() => setSearch(!search)}
            />
            <IconButton
              icon={MoreVertical}
              label="Más opciones de Campañas"
              onPress={() =>
                layers.open({
                  kind: "menu",
                  title: "Campañas",
                  content: (
                    <>
                      <NavRow
                        label="Ajustes de campañas"
                        onPress={() => {
                          layers.close();
                          router.push("/campaign-settings");
                        }}
                      />
                      <NavRow
                        label="Nueva campaña"
                        onPress={() => {
                          layers.close();
                          create();
                        }}
                      />
                    </>
                  ),
                })
              }
            />
          </>
        }
      />
      <MarketingTabs value="campaigns" />
      <Ready>
        {state.ready && (
          <>
            <PageScroll>
              {search && (
                <SearchBox
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar campaña"
                />
              )}
              <ErrorBanner error={a.error} />
              {store.campaigns().some((c) => c.status === "paused") && (
                <Banner type="danger">
                  Pausa de seguridad o manual · revisa las campañas detenidas.
                </Banner>
              )}
              <Stats
                rows={[
                  ["Mensajes este mes", store.metrics("month").sent],
                  ["Entregados", store.metrics("month").delivered],
                  ["Respondieron", store.metrics("month").replied],
                  ["Costo estimado", money(store.metrics("month").cents)],
                ]}
              />
              <FilterChips
                options={[
                  "Todas",
                  "En curso",
                  "Borrador",
                  "Terminadas",
                  "Pausadas",
                ]}
                value={filter}
                onChange={setFilter}
              />
              {!store.campaigns().length && (
                <EmptyState
                  title="Sin campañas todavía"
                  message="Crea una campaña exclusivamente ficticia."
                />
              )}
              {store
                .campaigns()
                .filter(
                  (c) =>
                    (filter === "Todas" ||
                      (c.status === "done"
                        ? "Terminadas"
                        : c.status === "paused"
                          ? "Pausadas"
                          : statusLabels[c.status]) === filter) &&
                    c.input.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((c) => (
                  <Card key={c.id}>
                    <NavRow
                      label={c.input.name}
                      onPress={() => router.push(`/campaign-detail?id=${c.id}`)}
                    />
                    <Text>{statusLabels[c.status]} · Simulada</Text>
                    <Text kind="meta">
                      {c.input.template || "Sin plantilla"} ·{" "}
                      {c.recipients.length} destinatarios
                    </Text>
                    <Text kind="meta">
                      {
                        c.recipients.filter((r) =>
                          ["delivered", "read", "replied"].includes(r.status),
                        ).length
                      }{" "}
                      enviados ficticios
                    </Text>
                  </Card>
                ))}
            </PageScroll>
          </>
        )}
      </Ready>
    </Screen>
  );
}
export function CampaignNew() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Screen>
      <Ready>
        <Wizard key={id} id={id} />
      </Ready>
    </Screen>
  );
}
function Wizard({ id }: { id: string }) {
  const { store } = useMarketing(),
    layers = useLayers(),
    a = useAction();
  let c;
  try {
    c = store.rawCampaign(id);
  } catch {
    return (
      <EmptyState
        title="Borrador no disponible"
        message="Crea una campaña desde Marketing."
      />
    );
  }
  return c.status !== "draft" || c.creator !== store.actor ? (
    <EmptyState
      title="Borrador no editable"
      message="Solo su creador puede continuar este borrador."
      action={
        <Button onPress={() => router.replace(`/campaign-detail?id=${id}`)}>
          Ver campaña
        </Button>
      }
    />
  ) : (
    <WizardForm key={id} campaign={c} store={store} />
  );
}
function WizardForm({
  campaign: c,
  store,
}: {
  campaign: Campaign;
  store: MarketingStore;
}) {
  const { colors: colors } = useTheme();
  const [input, setInput] = useState<Input>(c.input),
    [date, setDate] = useState(
      c.input.scheduledAt
        ? new Date(c.input.scheduledAt).toISOString()
        : new Date(Date.now() + 86400000).toISOString(),
    ),
    revision = useRef(c.revision),
    a = useAction(),
    layers = useLayers(),
    key = useRef(catalogKey()),
    step = c.step,
    set = (p: Partial<Input>) => setInput((i) => ({ ...i, ...p }));
  let plan: Plan | undefined,
    problem = "";
  if (step === 5)
    try {
      plan = store.plan(c.id);
    } catch (e) {
      problem = (e as Error).message;
    }
  let count = 0,
    preview = "";
  if (input.template)
    try {
      count = variables(store.templates.get(input.template).body);
      preview = store.templates.render(
        input.template,
        input.values.map((v) => (v === "$name" ? "Ana" : v)),
      );
    } catch (e) {
      preview = (e as Error).message;
    }
  const move = (delta: number) =>
    void a.run(async () => {
      if (delta > 0 && step === 1) {
        if (
          input.source === "audience" &&
          !store.audiences().some((x) => x.id === input.audience)
        )
          throw Error("Elige una base.");
        if (input.source === "tag" && !input.tag)
          throw Error("Elige una etiqueta.");
      }
      if (
        delta > 0 &&
        step === 4 &&
        input.when === "scheduled" &&
        !/(Z|[+-]\d{2}:\d{2})$/.test(date)
      )
        throw Error("Incluye zona horaria en la fecha ISO.");
      if (delta > 0 && step === 2)
        store.templates.assertApproved(input.template);
      if (delta > 0 && step === 3)
        store.templates.render(
          input.template,
          input.values.map((v) => (v === "$name" ? "Ana" : v)),
        );
      await store.saveDraft(
        c.id,
        input,
        step + delta,
        revision.current,
        catalogKey(),
      );
      revision.current = store.rawCampaign(c.id).revision;
    });
  return (
    <>
      <StudioBar
        title="Nueva campaña"
        subtitle={`Paso ${step} de 5 · ${["Público", "Plantilla", "Variables", "Cuándo", "Revisar"][step - 1]}`}
        onBack={() => router.back()}
      />
      <View
        accessibilityLabel={`Paso ${step} de 5`}
        style={{
          flexDirection: "row",
          gap: 4,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <View
            key={n}
            style={{
              height: 4,
              flex: 1,
              borderRadius: 2,
              backgroundColor: n <= step ? colors.accent : colors.border,
            }}
          />
        ))}
      </View>
      <PageScroll>
        <ErrorBanner error={a.error || problem} />
        {step === 1 && (
          <>
            <Field
              label="Nombre interno"
              value={input.name}
              onChangeText={(name) => set({ name })}
              maxLength={80}
            />
            <Section>Tipo de público</Section>
            {(
              [
                ["tag", "Por etiquetas"],
                ["audience", "Una base subida"],
                ["all", "Toda la base con opt-in"],
              ] as const
            ).map(([v, label]) => (
              <Choice
                radio
                key={v}
                label={label}
                checked={input.source === v}
                onPress={() => set({ source: v })}
              />
            ))}
            {input.source === "audience" &&
              store
                .audiences()
                .map((base) => (
                  <Choice
                    radio
                    key={base.id}
                    label={base.name}
                    checked={input.audience === base.id}
                    onPress={() => set({ audience: base.id })}
                  />
                ))}
            {input.source === "tag" &&
              store.conversations.catalog
                .tagNames()
                .map((tag) => (
                  <Choice
                    radio
                    key={tag}
                    label={tag}
                    checked={input.tag === tag}
                    onPress={() => set({ tag })}
                  />
                ))}
            <Banner>
              Solo contactos con opt-in explícito de las muestras. Se omiten
              bajas, archivados y marketing reciente.
            </Banner>
          </>
        )}
        {step === 2 && (
          <>
            {store.templates
              .rows()
              .filter((t) => t.status === "approved")
              .map((t) => (
                <Choice
                  radio
                  key={t.id}
                  label={t.name}
                  checked={input.template === t.id}
                  onPress={() => set({ template: t.id })}
                />
              ))}
            {!!preview && (
              <Card>
                <Text>{preview}</Text>
              </Card>
            )}
          </>
        )}
        {step === 3 && (
          <>
            {Array.from({ length: count }, (_, i) => (
              <View key={i}>
                {i === 0 && (
                  <Choice
                    radio
                    label="Nombre del contacto"
                    checked={input.values[0] === "$name"}
                    onPress={() =>
                      set({ values: ["$name", ...input.values.slice(1)] })
                    }
                  />
                )}
                <Field
                  label={`Variable ${i + 1} (texto fijo)`}
                  value={input.values[i] === "$name" ? "" : input.values[i]}
                  onChangeText={(v) =>
                    set({
                      values: input.values.map((x, n) => (n === i ? v : x)),
                    })
                  }
                  maxLength={200}
                />
              </View>
            ))}
            {count === 0 && <Text>Esta plantilla no requiere variables.</Text>}
            <Banner>
              Completa todas las variables. La vista previa nunca ejecuta un
              envío.
            </Banner>
            <Card>
              <Text>{preview}</Text>
            </Card>
          </>
        )}
        {step === 4 && (
          <>
            <Choice
              radio
              label="Enviar ahora (simulación)"
              checked={input.when === "now"}
              onPress={() => set({ when: "now" })}
            />
            <Choice
              radio
              label="Programar (simulación)"
              checked={input.when === "scheduled"}
              onPress={() =>
                set({ when: "scheduled", scheduledAt: Date.parse(date) })
              }
            />
            {input.when === "scheduled" && (
              <Field
                label="Fecha y hora (ISO con zona)"
                value={date}
                onChangeText={(v) => {
                  setDate(v);
                  const n = Date.parse(v);
                  set({ scheduledAt: Number.isFinite(n) ? n : 0 });
                }}
                maxLength={40}
              />
            )}
            <Field
              label="Número para la prueba"
              value={input.testPhone}
              onChangeText={(testPhone) => set({ testPhone })}
              maxLength={20}
            />
            <Button
              variant="secondary"
              onPress={() =>
                void a.run(async () => {
                  if (!/^\+1555010\d{4}$/.test(input.testPhone))
                    throw Error("Usa +1555010XXXX ficticio.");
                  store.templates.render(
                    input.template,
                    input.values.map((v) => (v === "$name" ? "Prueba" : v)),
                  );
                  layers.toast(
                    "Prueba local válida · no se envió ningún mensaje",
                  );
                })
              }
            >
              Simular prueba
            </Button>
            <Text>
              La programación es ficticia y solo avanza desde el laboratorio.
            </Text>
          </>
        )}
        {step === 5 && plan && (
          <>
            <Card>
              <Text>Campaña · {c.input.name}</Text>
              <Text>Público · {plan.ids.length} contactos con opt-in</Text>
              <Text>Omitidos · {plan.skipped}</Text>
              <Text>Plantilla · {c.input.template}</Text>
              <Text>
                Cuándo ·{" "}
                {c.input.when === "now"
                  ? "Ahora (solo simulación)"
                  : new Date(c.input.scheduledAt).toLocaleString("es-MX")}
              </Text>
              <Text>Costo estimado · {money(plan.estimate)}</Text>
            </Card>
            <Banner type="warning">
              Confirmar solo cambia el estado local. Nunca envía ni programa
              campañas reales.
            </Banner>
          </>
        )}
      </PageScroll>
      <View style={{ padding: 12, flexDirection: "row", gap: 12 }}>
        {step > 1 && (
          <Button variant="secondary" onPress={() => move(-1)}>
            Atrás
          </Button>
        )}
        {step < 5 ? (
          <Button onPress={() => move(1)}>Siguiente</Button>
        ) : (
          <Button
            disabled={!plan}
            onPress={() =>
              plan &&
              layers.open({
                kind: "dialog",
                title: "Confirma el envío",
                content: (
                  <ConfirmPlan
                    id={c.id}
                    store={store}
                    plan={plan!}
                    operationKey={key.current}
                  />
                ),
              })
            }
          >
            Programar campaña
          </Button>
        )}
      </View>
    </>
  );
}
function ConfirmPlan({
  id,
  store,
  plan,
  operationKey,
}: {
  id: string;
  store: MarketingStore;
  plan: Plan;
  operationKey: string;
}) {
  const [typed, setTyped] = useState(""),
    a = useAction(),
    layers = useLayers();
  return (
    <>
      <Text>
        Se marcarán {plan.ids.length} mensajes ficticios. Costo estimado{" "}
        {money(plan.estimate)}. No habrá programación ni envío real.
      </Text>
      <Field
        label={`Escribe ${plan.ids.length} para confirmar`}
        value={typed}
        onChangeText={setTyped}
        keyboardType="number-pad"
      />
      <ErrorBanner error={a.error} />
      <Button variant="secondary" onPress={layers.close}>
        Cancelar
      </Button>
      <Button
        onPress={() =>
          void a.run(async () => {
            await store.confirm(id, plan.signature, typed, operationKey);
            layers.close();
            router.replace(`/campaign-detail?id=${id}`);
          })
        }
      >
        Programar
      </Button>
    </>
  );
}
function Operation({
  message,
  run,
}: {
  message: string;
  run: () => Promise<unknown>;
}) {
  const a = useAction(),
    layers = useLayers();
  return (
    <>
      <Text>{message}</Text>
      <ErrorBanner error={a.error} />
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
export function CampaignDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Screen>
      <Ready>
        <CampaignBody id={id} />
      </Ready>
    </Screen>
  );
}
function CampaignBody({ id }: { id: string }) {
  const { store } = useMarketing(),
    layers = useLayers(),
    a = useAction();
  let c;
  try {
    c = store.campaign(id);
  } catch {
    return (
      <EmptyState
        title="Campaña no disponible"
        message="Regresa a Marketing."
        action={
          <Button onPress={() => router.replace("/(tabs)/marketing")}>
            Marketing
          </Button>
        }
      />
    );
  }
  const r = c.recipients,
    sent = r.filter((r) =>
      ["delivered", "read", "replied"].includes(r.status),
    ).length;
  const control = (action: "pause" | "resume" | "cancel") =>
    layers.open({
      kind: "dialog",
      title:
        action === "pause"
          ? "¿Pausar campaña?"
          : action === "resume"
            ? "¿Reanudar campaña?"
            : "¿Cancelar campaña?",
      content: (
        <Operation
          message="Solo modifica la simulación. Se conserva el historial. Se revalidan permisos, plantilla y destinatarios."
          run={() => store.control(c!.id, action, c!.revision, catalogKey())}
        />
      ),
    });
  return (
    <>
      <StudioBar
        title={c.input.name}
        subtitle={`${c.recipients.length} destinatarios ficticios`}
        onBack={() => router.back()}
        actions={
          <IconButton
            icon={MoreVertical}
            label="Más opciones de la campaña"
            onPress={() =>
              layers.open({
                kind: "menu",
                title: "Opciones de la campaña",
                content: (
                  <>
                    <NavRow
                      label="Duplicar"
                      onPress={() => {
                        layers.close();
                        void a.run(async () => {
                          const next = await store.duplicate(id, catalogKey());
                          router.push(`/campaign-new?id=${next}`);
                        });
                      }}
                    />
                    <NavRow
                      label="Cancelar campaña"
                      onPress={() => control("cancel")}
                    />
                  </>
                ),
              })
            }
          />
        }
      />
      <PageScroll>
        <Text>{statusLabels[c.status]} · Simulada</Text>
        {!!c.reason && <Banner type="warning">{c.reason}</Banner>}
        <ErrorBanner error={a.error} />
        <Funnel
          rows={[
            ["Enviados", sent],
            ["Entregados", sent],
            [
              "Leídos",
              r.filter((x) => ["read", "replied"].includes(x.status)).length,
            ],
            ["Respondieron", r.filter((x) => x.status === "replied").length],
          ]}
        />
        <Stats
          rows={[
            ["Fallidos", r.filter((x) => x.status === "failed").length],
            ["Costo estimado", money(sent * c.rate)],
          ]}
        />
        <Section>Destinatarios</Section>
        {!r.length && <Text>Sin destinatarios confirmados.</Text>}
        {r.map((r) => {
          let name = "Contacto no disponible";
          try {
            name = store.conversations.get(
              store.team.actor(store.actor),
              r.id,
            ).name;
          } catch {}
          return (
            <View
              key={r.id}
              style={{
                minHeight: 64,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 8,
              }}
            >
              <Avatar name={name} />
              <View style={{ flex: 1 }}>
                <Text weight="medium">{name}</Text>
                <Text kind="meta">
                  {recipientLabels[r.status]} · {r.reason || "Simulación local"}
                </Text>
              </View>
            </View>
          );
        })}
        {["running", "scheduled"].includes(c.status) && (
          <Button variant="secondary" onPress={() => control("pause")}>
            Pausar
          </Button>
        )}
        {c.status === "paused" && (
          <Button onPress={() => control("resume")}>Reanudar</Button>
        )}
        {c.status === "draft" && c.creator === store.actor && (
          <Button onPress={() => router.push(`/campaign-new?id=${c!.id}`)}>
            Continuar borrador
          </Button>
        )}
      </PageScroll>
    </>
  );
}
export function CampaignSettings() {
  return (
    <Screen>
      <StudioBar title="Ajustes de campañas" onBack={() => router.back()} />
      <PageScroll>
        <Ready>
          <SettingsForm />
        </Ready>
      </PageScroll>
    </Screen>
  );
}
function SettingsForm() {
  const { store, state } = useMarketing(),
    [form, setForm] = useState({
      threshold: String(state.doc.settings.threshold),
      frequencyDays: String(state.doc.settings.frequencyDays),
      marketing: (state.doc.settings.marketingCents / 100).toFixed(2),
      utility: (state.doc.settings.utilityCents / 100).toFixed(2),
    }),
    revision = useRef(state.doc.revision),
    a = useAction();
  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const cents = (v: string) => {
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(v))
      throw Error("Escribe la tarifa en MXN con hasta dos decimales.");
    const [whole, fraction = ""] = v.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  };
  return (
    <>
      <Section>Seguridad</Section>
      <Field
        label="Pausar si fallan más de (%)"
        value={form.threshold}
        onChangeText={(v) => set("threshold", v)}
        keyboardType="number-pad"
      />
      <Field
        label="Días mínimos entre mensajes de marketing"
        value={form.frequencyDays}
        onChangeText={(v) => set("frequencyDays", v)}
        keyboardType="number-pad"
      />
      <Section>Tarifas estimadas (MXN por mensaje)</Section>
      <Field
        label="Marketing"
        value={form.marketing}
        onChangeText={(v) => set("marketing", v)}
        keyboardType="decimal-pad"
      />
      <Field
        label="Utilidad"
        value={form.utility}
        onChangeText={(v) => set("utility", v)}
        keyboardType="decimal-pad"
      />
      <ErrorBanner error={a.error} />
      <Button
        onPress={() =>
          void a.run(async () => {
            if (
              !/^\d+$/.test(form.threshold) ||
              !/^\d+$/.test(form.frequencyDays)
            )
              throw Error("Umbral y frecuencia requieren números enteros.");
            await store.configure(
              {
                threshold: Number(form.threshold),
                frequencyDays: Number(form.frequencyDays),
                marketingCents: cents(form.marketing),
                utilityCents: cents(form.utility),
              },
              revision.current,
              catalogKey(),
            );
            revision.current = store.snapshot().doc.revision;
          })
        }
      >
        Guardar
      </Button>
    </>
  );
}
export function CampaignMetrics() {
  const { store, state } = useMarketing(),
    [period, setPeriod] = useState<"7" | "30" | "month">("30"),
    [reported, setReported] = useState(false),
    layers = useLayers();
  return (
    <Screen>
      <AppBar
        module
        title="Marketing"
        actions={
          <IconButton
            icon={Share2}
            label="Exportar métricas"
            onPress={() =>
              layers.toast(
                "Exportación CSV simulada · no se crea ni comparte un archivo",
              )
            }
          />
        }
      />
      <MarketingTabs value="metrics" />
      <Ready>
        {state.ready && (
          <PageScroll>
            <FilterChips
              options={["7 días", "30 días", "Este mes"]}
              value={
                period === "7"
                  ? "7 días"
                  : period === "30"
                    ? "30 días"
                    : "Este mes"
              }
              onChange={(v) =>
                setPeriod(
                  v === "7 días" ? "7" : v === "30 días" ? "30" : "month",
                )
              }
            />
            <SegmentedControl
              options={[
                { key: "estimate", label: "Estimado" },
                { key: "reported", label: "Reportado por Meta" },
              ]}
              value={reported ? "reported" : "estimate"}
              onChange={(v) => setReported(v === "reported")}
            />
            <Text kind="meta">
              Ambas fuentes son cifras ficticias del laboratorio. No hay
              reportes ni costos reales de Meta.
            </Text>
            <Stats
              rows={[
                ["Enviados", store.metrics(period, reported).sent],
                ["Entregados", store.metrics(period, reported).delivered],
                ["Leídos", store.metrics(period, reported).read],
                ["Respondieron", store.metrics(period, reported).replied],
                [
                  reported ? "Costo reportado ficticio" : "Costo estimado",
                  money(store.metrics(period, reported).cents),
                ],
                [
                  "Omitidos/bajas/frecuencia",
                  store.metrics(period, reported).skipped,
                ],
              ]}
            />
            <Section>Fallidos por motivo</Section>
            <Card>
              <Text>
                Fallo de prueba · {store.metrics(period, reported).failed}
              </Text>
            </Card>
            <Section>Campañas del periodo</Section>
            {!store.campaignsForPeriod(period).length && (
              <EmptyState
                title="Ninguna campaña envió en este periodo"
                message="Los resultados simulados aparecerán aquí."
              />
            )}
            {store.campaignsForPeriod(period).map((c) => (
              <NavRow
                key={c.id}
                label={c.input.name}
                onPress={() => router.push(`/campaign-detail?id=${c.id}`)}
              />
            ))}
          </PageScroll>
        )}
      </Ready>
    </Screen>
  );
}
export function CampaignLab() {
  const { store, state } = useMarketing(),
    a = useAction(),
    keys = useRef(new Map<string, string>());
  return (
    <Screen>
      <StudioBar title="Laboratorio de campañas" onBack={() => router.back()} />
      <PageScroll>
        <Ready>
          {state.ready && (
            <>
              <Banner>
                Avance manual de registros ficticios. No se ejecutan campañas,
                temporizadores, workers ni transportes de mensajes.
              </Banner>
              <ErrorBanner error={a.error} />
              {store.campaigns().map((c) => (
                <Card key={c.id}>
                  <Text>
                    {c.input.name} · {statusLabels[c.status]}
                  </Text>
                  {(["delivered", "read", "replied", "failed"] as const).map(
                    (outcome) => (
                      <Button
                        key={outcome}
                        variant="secondary"
                        onPress={() =>
                          void a.run(async () => {
                            const k = `${c.id}:${outcome}`,
                              key = keys.current.get(k) ?? catalogKey();
                            keys.current.set(k, key);
                            await store.advance(c.id, outcome, key);
                            keys.current.delete(k);
                          })
                        }
                      >{`${recipientLabels[outcome]} · ${c.input.name}`}</Button>
                    ),
                  )}
                </Card>
              ))}
            </>
          )}
        </Ready>
      </PageScroll>
    </Screen>
  );
}
