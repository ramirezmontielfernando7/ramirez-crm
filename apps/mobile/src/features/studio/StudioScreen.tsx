import { KeyboardScrollView as ScrollView } from "../keyboard/KeyboardScrollView";
import { Evaluations } from "./Evaluations";
import { Assignments } from "./Assignments";
import React, {
  memo,
  useState,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { View, Pressable, FlatList } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  Bot,
  ChevronRight,
  MoreVertical,
  Sparkles,
  FolderPlus,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
import { AppBar, IconButton } from "../../components/ModuleUi";
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
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { useInbox, useInboxState } from "../inbox/store";
import { KnowledgePanel } from "../knowledge/KnowledgeScreen";
import { ResultsStore } from "../results/core";
import { StudioGate } from "./AgentScreens";
import { useStudio, useStudioAction } from "./hooks";
import { AgentsMenu } from "./overlays";
import type { Agent } from "./model";
import type { StudioStore } from "./core";
export const studioTabs = [
  "Agentes",
  "Conocimiento",
  "Asignación",
  "Pruebas",
] as const;
export type StudioTab = (typeof studioTabs)[number];
const views = new WeakMap<StudioStore, { tab: StudioTab; offset: number }>();
export function StudioScreen({
  initialSection = "Agentes",
}: {
  initialSection?: StudioTab;
}) {
  return (
    <Screen>
      <StudioGate>
        <StudioView initialSection={initialSection} />
      </StudioGate>
    </Screen>
  );
}
function StudioView({ initialSection }: { initialSection: StudioTab }) {
  const { store, state } = useStudio(),
    inboxStore = useInbox(),
    params = useLocalSearchParams<{ section?: string }>(),
    [tab, setTab] = useState<StudioTab>(
      views.get(store)?.tab ?? initialSection,
    ),
    inbox = useInboxState(),
    layers = useLayers(),
    { colors: c } = useTheme(),
    action = useStudioAction();
  useEffect(() => {
    void store.library.hydrate();
  }, [store]);
  useEffect(() => {
    if (params.section === "knowledge") setTab("Conocimiento");
    if (params.section === "tests") setTab("Pruebas");
  }, [params.section]);
  useEffect(() => {
    views.set(store, { tab, offset: views.get(store)?.offset ?? 0 });
  }, [tab, store]);
  const changeTab = (value: StudioTab) => {
    setTab(value);
  };
  return (
    <>
      <AppBar
        module
        title="Estudio IA"
        actions={
          tab === "Agentes" ? (
            <IconButton
              icon={MoreVertical}
              label="Más opciones de Agentes"
              onPress={() =>
                layers.open({
                  kind: "menu",
                  title: "Más opciones de Agentes",
                  content: <AgentsMenu store={store} />,
                })
              }
            />
          ) : tab === "Conocimiento" ? (
            <IconButton
              icon={FolderPlus}
              label="Nuevo grupo"
              onPress={() =>
                layers.open({
                  kind: "sheet",
                  title: "Nuevo grupo",
                  content: <KnowledgeGroup store={store} />,
                })
              }
            />
          ) : undefined
        }
      />
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: "row",
          borderBottomWidth: 1,
          borderColor: c.border,
        }}
      >
        {studioTabs.map((t) => (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            aria-selected={tab === t}
            onPress={() => changeTab(t)}
            style={{
              flex: 1,
              minHeight: 48,
              justifyContent: "center",
              alignItems: "center",
              borderBottomWidth: tab === t ? 2 : 0,
              borderColor: c.accent,
            }}
          >
            <Text
              kind="capsule"
              weight="medium"
              style={{ color: tab === t ? c.accentInk : c.text3 }}
            >
              {t}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === "Conocimiento" ? (
        <KnowledgePanel store={store.library} />
      ) : !state.ready ? (
        state.error ? (
          <ErrorState
            onRetry={() => {
              inboxStore.reload();
              inboxStore.patch({ status: "normal" });
              void store.library.hydrate();
            }}
          />
        ) : (
          <Skeleton rows={4} />
        )
      ) : tab === "Agentes" ? (
        <AgentsList store={store} />
      ) : tab === "Asignación" ? (
        <Assignments store={store} />
      ) : tab === "Pruebas" ? (
        <Evaluations store={store} />
      ) : (
        <EmptyState
          title={`${tab} · Próximo lote`}
          message="Este apartado todavía no está implementado."
          action={
            <Button variant="tonal" onPress={() => setTab("Conocimiento")}>
              Ir a Conocimiento
            </Button>
          }
        />
      )}
    </>
  );
}
// Same approved group editor as Knowledge, keeping its atomic LibraryStore.
function KnowledgeGroup({ store }: { store: StudioStore }) {
  const [name, setName] = useState(""),
    action = useStudioAction(),
    { close } = useLayers();
  return (
    <>
      <GroupField value={name} onChangeText={setName} />
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button
        disabled={action.pending}
        onPress={() =>
          void action.run(async () => {
            await store.library.addKnowledgeGroup(name);
            close();
          })
        }
      >
        Crear grupo
      </Button>
    </>
  );
}
import { Field as GroupFieldBase } from "../../components/ui";
const GroupField = ({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (v: string) => void;
}) => (
  <GroupFieldBase
    label="Nombre del grupo"
    value={value}
    onChangeText={onChangeText}
    maxLength={60}
  />
);
function AgentsList({ store }: { store: StudioStore }) {
  const s = useInboxState(),
    inboxStore = useInbox(),
    doc = store.doc(),
    { colors: c } = useTheme(),
    action = useStudioAction(),
    usage = store.usageStats(),
    summary = useMemo(
      () => new ResultsStore(store.library.actor).summary(),
      [store],
    );
  const rows = s.status === "empty" ? [] : store.list();
  if (s.status === "loading") return <Skeleton rows={4} />;
  if (s.status === "error")
    return (
      <ErrorState
        onRetry={() => {
          inboxStore.reload();
          inboxStore.patch({ status: "normal" });
          void store.library.hydrate();
        }}
      />
    );
  return (
    <>
      {s.status === "offline" && (
        <Banner type="warning">
          Sin conexión · agentes ficticios locales.
        </Banner>
      )}
      <FlatList
        testID="agents-list"
        data={rows}
        keyExtractor={(a) => a.id}
        initialNumToRender={12}
        windowSize={7}
        contentContainerStyle={{ paddingBottom: 112 }}
        ListHeaderComponent={
          <>
            {doc.globalPaused && (
              <View>
                <Banner type="warning">
                  Todos los agentes en pausa. Los chats nuevos pasan a una
                  persona.
                </Banner>
                <Button
                  variant="ghost"
                  onPress={() => void action.run(() => store.pauseAll(false))}
                >
                  Reanudar
                </Button>
              </View>
            )}
            <View
              style={{
                padding: 16,
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              {[
                ["Chats atendidos por IA", String(summary.ai)],
                [
                  "Resueltos sin persona",
                  `${Math.round(((summary.ai - summary.handoffs) / summary.ai) * 100)} %`,
                ],
                ["Pasados a una persona", String(summary.handoffs)],
                ["IA usada este mes", `${usage.aiPercent} %`],
              ].map(([label, value]) => (
                <Card
                  key={label}
                  style={{
                    width: "48%",
                    paddingVertical: 12,
                    paddingHorizontal: 14,
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
                  {label === "IA usada este mes" && (
                    <View
                      style={{
                        height: 6,
                        backgroundColor: c.sunken,
                        borderRadius: 4,
                      }}
                    >
                      <View
                        style={{
                          height: 6,
                          width: `${Math.min(100, usage.aiPercent)}%`,
                          backgroundColor: c.accent,
                          borderRadius: 4,
                        }}
                      />
                    </View>
                  )}
                </Card>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Crea tu agente platicando"
              onPress={() => router.push("/studio-create")}
              style={{
                marginHorizontal: 16,
                padding: 16,
                borderRadius: 16,
                backgroundColor: c.bubbleAi,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}
            >
              <Sparkles color={c.accentInk} size={24} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text weight="semibold">Crea tu agente platicando</Text>
                <Text kind="secondary">
                  Cuéntame de tu negocio y yo lo armo.
                </Text>
              </View>
              <ChevronRight color={c.text3} size={20} />
            </Pressable>
            <View style={{ paddingHorizontal: 16 }}>
              <Section>Tus agentes</Section>
            </View>
            {!!action.error && <Banner type="danger">{action.error}</Banner>}
          </>
        }
        renderItem={({ item }) => <AgentRow agent={item} />}
        ListEmptyComponent={
          <EmptyState
            title="Aún no tienes agentes"
            message="Crea el primero platicando con el asistente."
            action={
              <Button onPress={() => router.push("/studio-create")}>
                Empezar
              </Button>
            }
          />
        }
      />
    </>
  );
}
const AgentRow = memo(function AgentRow({ agent: a }: { agent: Agent }) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Editar agente: ${a.name}`}
      onPress={() => router.push(`/studio-agent/${a.id}`)}
      style={{
        marginHorizontal: 16,
        marginBottom: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: c.bubbleAi,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Bot color={c.accentInk} size={24} />
      </View>
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Text kind="name" weight="medium">
            {a.name}
          </Text>
          {a.general && (
            <Text kind="meta" style={{ color: c.info }}>
              General
            </Text>
          )}
        </View>
        <Text
          kind="meta"
          style={{
            color: a.paused
              ? c.warning
              : a.versions.length
                ? c.success
                : c.warning,
          }}
        >
          {a.paused ? "En pausa" : a.versions.length ? "Publicado" : "Borrador"}{" "}
          ·{" "}
          {a.id === "demo-agent-a1"
            ? "128 chats · 81 %"
            : a.id === "demo-agent-a2"
              ? "46 chats · 72 %"
              : "0 chats · —"}
        </Text>
      </View>
    </Pressable>
  );
});
