import React, { useSyncExternalStore, useRef } from "react";
import { View, Pressable, ScrollView } from "react-native";
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Text,
  Skeleton,
} from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { useLayers } from "../../components/Layers";
import { useInbox, useInboxState } from "../inbox/store";
import type { StudioStore } from "./core";
import { useStudioAction } from "./hooks";
import { Choice } from "./overlays";
import { ChevronRight } from "lucide-react-native";
const noop = () => () => {};
function useCatalog(store: StudioStore) {
  const read = () =>
    store
      .stageRows()
      .map((s) => `${s.id}:${s.name}:${s.color}`)
      .join("|");
  useSyncExternalStore(
    store.conversations.subscribeCatalog ?? noop,
    read,
    read,
  );
}
export function Assignments({ store }: { store: StudioStore }) {
  useCatalog(store);
  const state = useInboxState(),
    inbox = useInbox(),
    layers = useLayers(),
    { colors: c } = useTheme();
  const rows = state.status === "empty" ? [] : store.stageRows(),
    doc = store.doc();
  if (state.status === "loading") return <Skeleton rows={5} />;
  if (state.status === "error")
    return (
      <ErrorState
        onRetry={() => {
          inbox.reload();
          inbox.patch({ status: "normal" });
        }}
      />
    );
  return (
    <>
      {state.status === "offline" && (
        <Banner type="warning">
          Sin conexión · asignaciones ficticias locales.
        </Banner>
      )}
      <ScrollView
        testID="studio-assignments"
        contentContainerStyle={{ paddingBottom: 112 }}
      >
        <View style={{ padding: 16 }}>
          <Text kind="secondary">
            Elige qué agente atiende cada etapa. Si una etapa no tiene agente,
            atiende el general.
          </Text>
        </View>
        {rows.map((stage) => {
          const id = doc.assignments[stage.id],
            a = doc.agents.find(
              (a) =>
                a.id === id && !a.archived && !a.general && a.versions.length,
            );
          return (
            <Pressable
              key={stage.id}
              accessibilityRole="button"
              accessibilityLabel={`Etapa ${stage.name}: ${a?.name ?? "Agente general"}`}
              onPress={() =>
                layers.open({
                  kind: "sheet",
                  title: `Etapa «${stage.name}»`,
                  content: (
                    <AssignSheet
                      store={store}
                      stageId={stage.id}
                      stageName={stage.name}
                    />
                  ),
                })
              }
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 14,
                minHeight: 56,
                borderBottomWidth: 1,
                borderColor: c.border,
              }}
            >
              <View
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: stage.color,
                }}
              />
              <Text style={{ flex: 1 }}>{stage.name}</Text>
              <Text kind="secondary" style={{ flex: 1, textAlign: "right" }}>
                {a?.name ?? "Agente general"}
              </Text>
              <ChevronRight size={18} color={c.text3} />
            </Pressable>
          );
        })}
        {!rows.length && (
          <EmptyState
            title="Tu pipeline no tiene etapas"
            message="Crea etapas en CRM › Pipeline."
          />
        )}
      </ScrollView>
    </>
  );
}
export function AssignSheet({
  store,
  stageId,
  stageName,
}: {
  store: StudioStore;
  stageId: string;
  stageName: string;
}) {
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useCatalog(store);
  const doc = store.doc(),
    previous = useRef(doc.assignments[stageId] ?? null),
    [pending, setPending] = React.useState<string | null | undefined>(
      undefined,
    ),
    action = useStudioAction(),
    layers = useLayers();
  const selected = doc.assignments[stageId] ?? null,
    eligible = store.list().filter((a) => !a.general && a.versions.length),
    exists = store.stageRows().some((s) => s.id === stageId);
  const assign = (id: string | null) =>
    void action.run(async () => {
      await store.assign(stageId, id, previous.current);
      if (!store.stageRows().some((s) => s.id === stageId))
        throw Error(
          "La etapa fue eliminada durante el guardado. No se aplicará al enrutamiento.",
        );
      layers.close();
    });
  const choose = (id: string | null) => {
    if (selected === id) {
      layers.close();
      return;
    }
    if (previous.current !== null) {
      setPending(id);
      return;
    }
    assign(id);
  };
  if (!exists)
    return (
      <EmptyState
        title="La etapa ya no existe"
        message="Regresa al Pipeline para revisar sus etapas actuales."
      />
    );
  return (
    <View pointerEvents={action.pending ? "none" : "auto"}>
      <View accessibilityRole="radiogroup">
        <Choice
          label="Agente general"
          checked={selected === null}
          description="Atiende lo que no tiene agente propio"
          onPress={() => choose(null)}
        />
        {eligible.map((a) => (
          <Choice
            key={a.id}
            label={a.name}
            checked={selected === a.id}
            description={`${a.versions.at(-1)!.config.tone}${a.paused ? " · En pausa" : ""}`}
            onPress={() => choose(a.id)}
          />
        ))}
      </View>
      {pending !== undefined && (
        <>
          <Text>¿Reemplazar la asignación de «{stageName}»?</Text>
          <Button
            variant="secondary"
            disabled={action.pending}
            onPress={() => setPending(undefined)}
          >
            Cancelar cambio
          </Button>
          <Button disabled={action.pending} onPress={() => assign(pending)}>
            Confirmar reemplazo
          </Button>
        </>
      )}
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
    </View>
  );
}
