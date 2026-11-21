import { KeyboardScrollView as ScrollView } from "../keyboard/KeyboardScrollView";
import React, { useState, useEffect } from "react";
import { View, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { CircleCheck, TriangleAlert, CircleX } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PickerRow,
  Section,
  Skeleton,
  Text,
} from "../../components/ui";
import { FilterChips } from "../../components/ModuleUi";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { useInbox, useInboxState } from "../inbox/store";
import type { StudioStore } from "./core";
import { StudioGate } from "./AgentScreens";
import { useStudio, useStudioAction } from "./hooks";
import { StudioBar } from "./StudioBar";
import { StudioBubble } from "./StudioBubble";
import { Choice } from "./overlays";
import type { Evaluation } from "./model";
const views = new WeakMap<
  StudioStore,
  {
    agentId: string;
    source: "draft" | "published";
    count: 3 | 5 | 8;
    runId: string | null;
  }
>();
export const gradeLabel = (grade: Evaluation["grade"]) =>
  grade === "ok" ? "Bien" : grade === "review" ? "Revisar" : "Falló";
export function Evaluations({ store }: { store: StudioStore }) {
  const saved = views.get(store),
    doc = store.doc(),
    fallback = store.list()[0]!,
    [agentId, setAgent] = useState(saved?.agentId ?? fallback.id),
    [source, setSource] = useState<"draft" | "published">(
      saved?.source ?? "draft",
    ),
    [count, setCount] = useState<3 | 5 | 8>(saved?.count ?? 5),
    [runId, setRun] = useState<string | null>(
      saved?.runId ?? doc.runs[0]?.id ?? null,
    ),
    action = useStudioAction(),
    layers = useLayers(),
    { colors: c } = useTheme(),
    inbox = useInbox(),
    status = useInboxState().status;
  const a = store.list().find((a) => a.id === agentId) ?? fallback,
    run = doc.runs.find((r) => r.id === runId),
    label = `${source === "draft" ? "Borrador" : "Publicada"} de «${a.name}»`;
  useEffect(() => {
    views.set(store, { agentId: a.id, source, count, runId });
  }, [store, a.id, source, count, runId]);
  const start = () =>
    void action.run(async () => {
      const id = await store.run(a.id, source, count);
      setRun(id);
    });
  const choose = () =>
    layers.open({
      kind: "sheet",
      title: "Qué versión se prueba",
      content: (
        <>
          {store.list().map((agent) => (
            <React.Fragment key={agent.id}>
              <Choice
                label={`Borrador de «${agent.name}»`}
                checked={agentId === agent.id && source === "draft"}
                onPress={() => {
                  setAgent(agent.id);
                  setSource("draft");
                  layers.close();
                }}
              />
              {!!agent.versions.length && (
                <Choice
                  label={`Publicada de «${agent.name}»`}
                  checked={agentId === agent.id && source === "published"}
                  onPress={() => {
                    setAgent(agent.id);
                    setSource("published");
                    layers.close();
                  }}
                />
              )}
            </React.Fragment>
          ))}
        </>
      ),
    });
  return (
    <>
      {status === "offline" && (
        <Banner type="warning">Sin conexión · simulaciones locales.</Banner>
      )}
      <ScrollView
        testID="agent-evaluations"
        contentContainerStyle={{ padding: 16, paddingBottom: 112 }}
      >
        <View pointerEvents={action.pending ? "none" : "auto"}>
          <PickerRow
            label="Qué versión se prueba"
            value={label}
            onPress={choose}
          />
          <Text kind="secondary">Cuántos clientes</Text>
          <FilterChips
            options={["3", "5", "8"]}
            value={String(count)}
            onChange={(v) => setCount(Number(v) as 3 | 5 | 8)}
          />
          <Button disabled={action.pending} onPress={start}>
            {`Probar con ${count} clientes`}
          </Button>
          <Text kind="meta" style={{ marginTop: 8 }}>
            Simulación local: no usa IA ni consume crédito del plan.
          </Text>
        </View>
        {!!action.error && <Banner type="danger">{action.error}</Banner>}
        {action.pending || status === "loading" ? (
          <>
            <Section>Conversando…</Section>
            <Skeleton rows={3} />
          </>
        ) : status === "error" ? (
          <ErrorState
            onRetry={() => {
              inbox.reload();
              inbox.patch({ status: "normal" });
            }}
          />
        ) : !run || status === "empty" ? (
          <EmptyState
            title="Aún no hay pruebas"
            message="Elige cuántos clientes simulados y pulsa «Probar»."
          />
        ) : (
          <>
            <Section>Resultados · {run.count} clientes</Section>
            {run.results.map((e) => {
              const color =
                  e.grade === "ok"
                    ? c.success
                    : e.grade === "review"
                      ? c.warning
                      : c.danger,
                Icon =
                  e.grade === "ok"
                    ? CircleCheck
                    : e.grade === "review"
                      ? TriangleAlert
                      : CircleX;
              return (
                <Pressable
                  key={e.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Prueba: ${e.name}, ${gradeLabel(e.grade)}`}
                  onPress={() =>
                    router.push(`/studio-evaluation/${e.id}?run=${run.id}`)
                  }
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  <Icon size={24} color={color} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text weight="medium">{e.name}</Text>
                    <Text kind="secondary">{e.summary}</Text>
                  </View>
                  <Text kind="meta" style={{ color }}>
                    {gradeLabel(e.grade)}
                  </Text>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </>
  );
}
export function EvaluationScreen() {
  return (
    <Screen>
      <StudioGate>
        <EvaluationEntry />
      </StudioGate>
    </Screen>
  );
}
function EvaluationEntry() {
  const { store, state } = useStudio(),
    { id, run } = useLocalSearchParams<{ id: string; run: string }>();
  useEffect(() => {
    void store.library.hydrate();
  }, [store]);
  if (!state.ready)
    return state.error ? (
      <ErrorState onRetry={() => void store.library.hydrate()} />
    ) : (
      <Skeleton rows={3} />
    );
  let record;
  try {
    record = store.runGet(run);
    if (!record.results.some((e) => e.id === id)) throw Error("No disponible");
  } catch {
    return (
      <>
        <StudioBar title="Prueba no disponible" onBack={() => router.back()} />
        <EmptyState
          title="Prueba no disponible"
          message="La prueba pudo salir del historial local de demostración."
        />
      </>
    );
  }
  return <EvaluationDetail key={`${run}:${id}`} runId={run} id={id} />;
}
function EvaluationDetail({ runId, id }: { runId: string; id: string }) {
  const { store } = useStudio(),
    run = store.runGet(runId),
    e = run.results.find((e) => e.id === id)!,
    action = useStudioAction(),
    { colors: c } = useTheme(),
    original = e.attempts?.[0],
    latest = e.attempts?.at(-1),
    color =
      e.grade === "ok"
        ? c.success
        : e.grade === "review"
          ? c.warning
          : c.danger;
  const fix =
    e.name === "Quiere una cita"
      ? "No asegures una cita sin disponibilidad confirmada; pasa el chat a una persona."
      : "No prometas descuentos; si piden uno, pasa el chat a una persona.";
  return (
    <>
      <StudioBar
        title={e.name}
        subtitle="Cliente simulado"
        onBack={() =>
          router.canGoBack()
            ? router.back()
            : router.replace("/(tabs)/studio?section=tests")
        }
        actions={
          <Text kind="meta" style={{ color, paddingRight: 12 }}>
            {gradeLabel(e.grade)}
          </Text>
        }
      />
      <ScrollView
        testID="evaluation-detail"
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }}
      >
        <View
          style={{
            padding: 12,
            gap: 12,
            borderRadius: 16,
            backgroundColor: c.sunken,
          }}
        >
          <StudioBubble text={e.question} meta="sim" />
          <StudioBubble
            text={e.answer}
            variant="ai"
            who="Agente · simulación"
            meta="sim"
          />
          <StudioBubble text="Gracias por la información." meta="sim" />
        </View>
        <Section>Qué pasó</Section>
        <Card>
          <Text>{e.summary}</Text>
          <Text kind="meta">
            Origen:{" "}
            {run.source === "published"
              ? `publicada v${run.version}`
              : "borrador"}{" "}
            · revisión {run.revision}
          </Text>
          {e.repeat > 0 && (
            <Text kind="meta">
              Repetido con borrador · revisión {latest?.revision ?? "—"} ·{" "}
              {e.repeat} repetición(es)
            </Text>
          )}
        </Card>
        {e.grade !== "ok" && (
          <>
            <Section>Arreglo sugerido</Section>
            <Card>
              <Text>Agrega a las instrucciones: «{fix}»</Text>
              <Button
                variant="tonal"
                disabled={action.pending || e.proposed}
                onPress={() =>
                  void action.run(() =>
                    store.proposeFix(
                      runId,
                      id,
                      store.get(run.agentId).revision,
                    ),
                  )
                }
              >
                {e.proposed
                  ? "Arreglo guardado en el borrador"
                  : "Proponer arreglo"}
              </Button>
            </Card>
          </>
        )}
        {!!action.error && <Banner type="danger">{action.error}</Banner>}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              variant="secondary"
              disabled={action.pending}
              onPress={() => void action.run(() => store.repeat(runId, id))}
            >
              Repetir
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              variant="secondary"
              disabled={action.pending}
              onPress={() =>
                void action.run(async () => {
                  await store.assistantContext(runId, id);
                  router.push("/assistant");
                })
              }
            >
              En el asistente
            </Button>
          </View>
        </View>
      </ScrollView>
    </>
  );
}
