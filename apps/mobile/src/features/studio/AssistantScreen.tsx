import { AssistantLimit } from "../usage/UsageScreens";
import React, { useState, useEffect, useRef } from "react";
import { View, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import {
  Archive,
  History,
  MoreVertical,
  Plus,
  Sparkles,
} from "lucide-react-native";
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
import { FilterChips, IconButton } from "../../components/ModuleUi";
import { useSession } from "../../state/SessionProvider";
import { canAccess } from "../../domain/access";
import { useTheme } from "../../theme/ThemeProvider";
import { useLayers } from "../../components/Layers";
import { useInbox } from "../inbox/store";
import { StudioBar } from "./StudioBar";
import { StudioComposer } from "./StudioBubble";
import { useStudio, useStudioAction } from "./hooks";
import { Choice } from "./overlays";
import type { StudioStore } from "./core";
import { studioKey } from "./core";
export function AssistantScreen() {
  const { session, disabled } = useSession();
  return (
    <Screen keyboard>
      {!session ||
      session.role !== "owner" ||
      !canAccess(session.role, "more", disabled) ? (
        <EmptyState
          title="Acceso no permitido"
          message="El asistente de demostración requiere perfil Propietario."
        />
      ) : (
        <AssistantEntry />
      )}
    </Screen>
  );
}
function AssistantEntry() {
  const { store, state } = useStudio();
  useEffect(() => {
    void store.library.hydrate();
  }, [store]);
  if (!state.ready)
    return state.error ? (
      <ErrorState onRetry={() => void store.library.hydrate()} />
    ) : (
      <Skeleton rows={3} />
    );
  if (store.usageStats().assistantBlocked)
    return <AssistantLimit store={store} />;
  return <AssistantView key={store.activeAssistant().id} />;
}
const inputDrafts = new WeakMap<StudioStore, Map<string, string>>();
function AssistantView() {
  const { store } = useStudio(),
    thread = store.activeAssistant(),
    [text, setText] = useState(inputDrafts.get(store)?.get(thread.id) ?? ""),
    action = useStudioAction(),
    layers = useLayers(),
    inbox = useInbox(),
    { colors: c } = useTheme(),
    key = useRef(studioKey()),
    mode = store.assistantData().mode;
  useEffect(() => {
    let m = inputDrafts.get(store);
    if (!m) {
      m = new Map();
      inputDrafts.set(store, m);
    }
    m.set(thread.id, text);
  }, [store, thread.id, text]);
  const send = (q = text) =>
    void action.run(async () => {
      await store.assistantAsk(q, key.current);
      const m = inputDrafts.get(store);
      if (m?.get(thread.id) === q) m.set(thread.id, "");
      key.current = studioKey();
      setText((v) => (v === q ? "" : v));
    });
  return (
    <>
      <StudioBar
        title="Asistente"
        subtitle={
          mode === "fast" ? "Rápido" : mode === "deep" ? "Profundo" : "Normal"
        }
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/more")
        }
        actions={
          <>
            <IconButton
              icon={History}
              label="Conversaciones"
              onPress={() =>
                layers.open({
                  kind: "sheet",
                  title: "Conversaciones",
                  content: <AssistantHistory store={store} />,
                })
              }
            />
            <IconButton
              icon={MoreVertical}
              label="Modo y crédito"
              onPress={() =>
                layers.open({
                  kind: "sheet",
                  title: "Modo y crédito",
                  content: <AssistantMode store={store} />,
                })
              }
            />
          </>
        }
      />
      <ScrollView
        testID="assistant-thread"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }}
      >
        {!thread.turns.length && (
          <>
            <View
              style={{
                alignItems: "center",
                paddingTop: 44,
                paddingBottom: 6,
                paddingHorizontal: 16,
                gap: 10,
              }}
            >
              <View
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 26,
                  backgroundColor: c.bubbleAi,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 6,
                }}
              >
                <Sparkles size={34} color={c.accentInk} />
              </View>
              <Text
                weight="semibold"
                style={{ fontSize: 18, lineHeight: 24, textAlign: "center" }}
              >
                ¿En qué te ayudo?
              </Text>
              <Text
                kind="secondary"
                style={{ textAlign: "center", maxWidth: 290, color: c.text3 }}
              >
                Pregunta lo que quieras sobre tu negocio. Para cambiar algo, te
                lo propongo y tú aplicas.
              </Text>
            </View>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
                paddingBottom: 8,
              }}
            >
              {[
                "Audita mis agentes de IA",
                "Revisa los chats que contestó la IA",
                "¿Cuánto vendí este mes?",
                "Etiqueta a quienes pidieron cotización",
              ].map((q) => (
                <Pressable
                  key={q}
                  accessibilityRole="button"
                  accessibilityLabel={q}
                  onPress={() => {
                    key.current = studioKey();
                    send(q);
                  }}
                  style={{
                    minHeight: 44,
                    maxWidth: "100%",
                    borderWidth: 1,
                    borderColor: c.borderStrong,
                    borderRadius: 16,
                    paddingVertical: 8,
                    paddingHorizontal: 13,
                    backgroundColor: c.surface,
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{ fontSize: 13.5, lineHeight: 18, color: c.text2 }}
                  >
                    {q}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {thread.turns.map((t) => (
          <React.Fragment key={t.id}>
            <View
              style={{
                alignSelf: "flex-end",
                maxWidth: "92%",
                padding: 12,
                borderRadius: 16,
                backgroundColor: c.wash,
                borderBottomRightRadius: 4,
              }}
            >
              <Text>{t.question}</Text>
            </View>
            <View
              style={{
                alignSelf: "flex-start",
                maxWidth: "96%",
                paddingVertical: 8,
                backgroundColor: "transparent",
                gap: 10,
              }}
            >
              <Text>{t.answer}</Text>
              {!!t.tagTargets?.length && (
                <Card>
                  <Text weight="semibold">
                    Etiquetar {t.tagTargets.length} contactos · «Seguimiento»
                  </Text>
                  <Text kind="meta">
                    {t.tagTargets
                      .slice(0, 3)
                      .map((id) => {
                        try {
                          return store.conversations.get(
                            store.library.actor,
                            id,
                          ).name;
                        } catch {
                          return "Contacto no disponible";
                        }
                      })
                      .join(", ")}
                  </Text>
                  {t.dismissed ? (
                    <Text kind="meta">Propuesta descartada</Text>
                  ) : (
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Button
                          variant="tonal"
                          disabled={
                            store.assistantTagsApplied(t) || action.pending
                          }
                          onPress={() =>
                            void action.run(async () => {
                              store.assistantApplyTags(t.id);
                              inbox.reload();
                            })
                          }
                        >
                          {store.assistantTagsApplied(t)
                            ? "Aplicado"
                            : "Aplicar"}
                        </Button>
                      </View>
                      {!store.assistantTagsApplied(t) && (
                        <View style={{ flex: 1 }}>
                          <Button
                            variant="secondary"
                            disabled={action.pending}
                            onPress={() =>
                              void action.run(() =>
                                store.assistantDismiss(t.id),
                              )
                            }
                          >
                            Descartar
                          </Button>
                        </View>
                      )}
                    </View>
                  )}
                </Card>
              )}
              <Text kind="meta">
                Datos de:{" "}
                {t.context
                  ? "prueba local de agentes"
                  : t.tagTargets
                    ? "Bandeja ficticia"
                    : "Resultados y Estudio IA ficticios"}
              </Text>
              {t.context && (
                <Text kind="meta">
                  Contexto: prueba local de agentes · no se modificó su versión
                  publicada.
                </Text>
              )}
            </View>
          </React.Fragment>
        ))}
        {!!action.error && <Banner type="danger">{action.error}</Banner>}
      </ScrollView>
      <StudioComposer
        label="Pregunta al asistente"
        sendLabel="Enviar al asistente"
        value={text}
        onChange={(v) => {
          setText(v);
          key.current = studioKey();
        }}
        onSend={() => send()}
        disabled={action.pending}
      />
    </>
  );
}
export function AssistantHistory({ store }: { store: StudioStore }) {
  const { close } = useLayers(),
    action = useStudioAction(),
    { colors: c } = useTheme();
  return (
    <>
      <View style={{ gap: 4 }}>
        {store.assistantThreads().map((t) => (
          <View
            key={t.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              borderBottomWidth: 1,
              borderColor: c.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Button
                variant="ghost"
                disabled={action.pending}
                onPress={() =>
                  void action.run(async () => {
                    await store.assistantSelect(t.id);
                    close();
                  })
                }
              >
                {t.title}
              </Button>
              {t.id === "demo-assistant-general" && (
                <Text kind="meta">Fijo</Text>
              )}
            </View>
            {t.id !== "demo-assistant-general" && (
              <IconButton
                icon={Archive}
                label={`Archivar hilo: ${t.title}`}
                onPress={() =>
                  void action.run(async () => {
                    await store.assistantArchive(t.id);
                    close();
                  })
                }
              />
            )}
          </View>
        ))}
      </View>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button
        icon={Plus}
        variant="tonal"
        disabled={action.pending}
        onPress={() =>
          void action.run(async () => {
            await store.assistantNew();
            close();
          })
        }
      >
        Hilo nuevo
      </Button>
    </>
  );
}
export function AssistantMode({ store }: { store: StudioStore }) {
  const action = useStudioAction(),
    { close } = useLayers(),
    { colors: c } = useTheme(),
    usage = store.usageStats(),
    mode = store.assistantData().mode;
  return (
    <>
      <View accessibilityRole="radiogroup">
        {(["fast", "normal", "deep"] as const).map((m, i) => (
          <Choice
            key={m}
            label={["Rápido", "Normal", "Profundo"][i]!}
            checked={m === mode}
            description={["Respuesta breve", "Equilibrado", "Más detalle"][i]}
            onPress={() =>
              void action.run(async () => {
                await store.assistantMode(m);
                close();
              })
            }
          />
        ))}
      </View>
      <Section>Crédito del asistente</Section>
      <View style={{ height: 6, borderRadius: 4, backgroundColor: c.sunken }}>
        <View
          style={{
            height: 6,
            width: `${Math.min(100, usage.assistantPercent)}%`,
            borderRadius: 4,
            backgroundColor: c.accent,
          }}
        />
      </View>
      <Text kind="meta">
        {usage.assistantPercent} % usado este mes · dato de demostración
      </Text>
      <Section>Avance</Section>
      <Text kind="secondary">
        Simulación local: ninguna consulta consume IA ni crédito real.
      </Text>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
    </>
  );
}
