import { StudioBubble, StudioComposer } from "./StudioBubble";
import { StudioBar } from "./StudioBar";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, ScrollView, Pressable, BackHandler } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  FileText,
  MessageCircle,
  MoreVertical,
  Smile,
  Sparkles,
  UserCheck,
  UserRound,
  Send,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
import { AppBar, IconButton, FilterChips } from "../../components/ModuleUi";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  MessageBubble,
  Skeleton,
  Switch,
  Text,
} from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useSession } from "../../state/SessionProvider";
import { canAccess } from "../../domain/access";
import { useTheme } from "../../theme/ThemeProvider";
import { useStudio, useStudioAction } from "./hooks";
import { AgentMenu, PreviewSheet, PublishDialog } from "./overlays";
import { studioKey } from "./core";
export function StudioGate({ children }: React.PropsWithChildren) {
  const { session, disabled } = useSession();
  return !session || !canAccess(session.role, "studio", disabled) ? (
    <EmptyState
      title="Acceso no permitido"
      message="Tu perfil no tiene acceso a Estudio IA."
    />
  ) : (
    <>{children}</>
  );
}
export function AgentEditorScreen() {
  return (
    <Screen keyboard>
      <StudioGate>
        <EditorEntry />
      </StudioGate>
    </Screen>
  );
}
function EditorEntry() {
  const { store, state } = useStudio(),
    { id } = useLocalSearchParams<{ id: string }>();
  useEffect(() => {
    void store.library.hydrate();
  }, [store]);
  if (!state.ready)
    return state.error ? (
      <ErrorState onRetry={() => void store.library.hydrate()} />
    ) : (
      <Skeleton rows={4} />
    );
  try {
    store.get(id ?? "");
  } catch {
    return (
      <>
        <AppBar
          title="Agente no disponible"
          onBack={() => router.replace("/(tabs)/studio")}
        />
        <EmptyState
          title="Agente no disponible"
          message="El agente fue archivado o no tienes acceso."
        />
      </>
    );
  }
  return <Editor key={id} id={id} />;
}
function Editor({ id }: { id: string }) {
  const { store, state } = useStudio(),
    a = store.get(id),
    config = store.config(id),
    layers = useLayers(),
    { colors: c } = useTheme(),
    action = useStudioAction(),
    [expanded, setExpanded] = useState<ReadonlySet<string>>(
      new Set(["identity"]),
    ),
    error = action.error || store.snapshot().error;
  useEffect(() => {
    if (!store.dirty(id) || state.saving || error) return;
    const timer = setTimeout(() => {
      void store.flush(id).catch(() => {});
    }, 650);
    return () => clearTimeout(timer);
  }, [store, id, config, state.saving, error]);
  const leave = useCallback(() => {
    void action.run(async () => {
      await store.flush(id);
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/studio");
    });
  }, [store, id]);
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (layers.layer) return false;
        leave();
        return true;
      });
      return () => sub.remove();
    }, [layers.layer, leave]),
  );
  const open = async (kind: "menu" | "preview" | "publish") =>
    action.run(async () => {
      await store.flush(id);
      layers.open(
        kind === "menu"
          ? {
              kind: "menu",
              title: "Más opciones del agente",
              content: <AgentMenu store={store} id={id} />,
            }
          : {
              kind: kind === "publish" ? "dialog" : "sheet",
              title:
                kind === "publish" ? "¿Publicar este agente?" : "Vista previa",
              content:
                kind === "publish" ? (
                  <PublishDialog store={store} id={id} />
                ) : (
                  <PreviewSheet store={store} id={id} />
                ),
            },
      );
    });
  const edit = (patch: Parameters<typeof store.edit>[1]) => {
    try {
      store.edit(id, patch);
    } catch (e) {
      layers.toast((e as Error).message);
    }
  };
  const sections = [
    ["identity", "Identidad", UserRound],
    ["instructions", "Instrucciones", FileText],
    ["tone", "Tono", Smile],
    ["handoff", "Cuándo pasa a persona", UserCheck],
    ["greeting", "Saludo", MessageCircle],
    ["knowledge", "Conocimiento y documentos", BookOpen],
  ] as const;
  return (
    <>
      <StudioBar
        title={a.name}
        subtitle={
          a.versions.length ? "Publicado · borrador con cambios" : "Borrador"
        }
        onBack={leave}
        actions={
          <IconButton
            icon={MoreVertical}
            label="Más opciones del agente"
            onPress={() => void open("menu")}
          />
        }
      />
      <ScrollView
        testID="agent-editor-scroll"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }}
      >
        <Banner>
          No cambia lo que atiende a tus clientes hasta que pulses «Publicar».
        </Banner>
        {a.paused && (
          <Banner type="warning">
            Agente en pausa · los chats nuevos pasan a una persona.
          </Banner>
        )}
        {!!error && (
          <>
            <Banner type="danger">{error}</Banner>
            <Button
              variant="secondary"
              onPress={() => void action.run(() => store.flush(id))}
            >
              Reintentar guardado
            </Button>
          </>
        )}
        {sections.map(([key, label, Icon]) => (
          <Card key={key} style={{ padding: 0 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${expanded.has(key) ? "expandido" : "contraído"}`}
              accessibilityState={{ expanded: expanded.has(key) }}
              aria-expanded={expanded.has(key)}
              onPress={() =>
                setExpanded((old) => {
                  const s = new Set(old);
                  s.has(key) ? s.delete(key) : s.add(key);
                  return s;
                })
              }
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 14,
                minHeight: 52,
              }}
            >
              <Icon size={22} color={c.text3} />
              <Text style={{ flex: 1 }}>{label}</Text>
              {expanded.has(key) ? (
                <ChevronUp size={18} color={c.text3} />
              ) : (
                <ChevronDown size={18} color={c.text3} />
              )}
            </Pressable>
            {expanded.has(key) && (
              <View
                style={{
                  padding: 16,
                  borderTopWidth: 1,
                  borderColor: c.border,
                  gap: 10,
                }}
              >
                {key === "identity" ? (
                  <>
                    <Field
                      label="Nombre de presentación (opcional)"
                      value={config.displayName}
                      onChangeText={(displayName) => edit({ displayName })}
                      maxLength={80}
                      placeholder="Sin nombre: habla como el equipo"
                    />
                    <Switch
                      label="Habla como el equipo"
                      value={config.speakAsTeam}
                      onChange={(speakAsTeam) => edit({ speakAsTeam })}
                    />
                  </>
                ) : key === "instructions" ? (
                  <Field
                    label="Instrucciones"
                    value={config.instructions}
                    onChangeText={(instructions) => edit({ instructions })}
                    maxLength={12000}
                    multiline
                    style={{ minHeight: 150, textAlignVertical: "top" }}
                  />
                ) : key === "tone" ? (
                  <Field
                    label="Tono"
                    value={config.tone}
                    onChangeText={(tone) => edit({ tone })}
                    maxLength={300}
                  />
                ) : key === "handoff" ? (
                  <Field
                    label="Cuándo pasar la conversación a un humano…"
                    value={config.handoff}
                    onChangeText={(handoff) => edit({ handoff })}
                    maxLength={2000}
                    multiline
                    style={{ minHeight: 96, textAlignVertical: "top" }}
                  />
                ) : key === "greeting" ? (
                  <Field
                    label="Saludo para conversaciones nuevas"
                    value={config.greeting}
                    onChangeText={(greeting) => edit({ greeting })}
                    maxLength={2000}
                    multiline
                    style={{ minHeight: 96, textAlignVertical: "top" }}
                  />
                ) : (
                  <>
                    <Switch
                      label="Usar el conocimiento compartido"
                      value={a.general || config.sharedKnowledge}
                      onChange={(sharedKnowledge) =>
                        a.general
                          ? layers.toast(
                              "El agente general siempre lee el compartido",
                            )
                          : edit({ sharedKnowledge })
                      }
                    />
                    <Text kind="meta">
                      El agente general siempre lee el compartido.
                    </Text>
                    <Button
                      variant="ghost"
                      onPress={() =>
                        void action.run(async () => {
                          await store.flush(id);
                          router.push("/(tabs)/studio?section=knowledge");
                        })
                      }
                    >
                      Fuentes de documentos
                    </Button>
                  </>
                )}
              </View>
            )}
          </Card>
        ))}
      </ScrollView>
      <View
        style={{
          padding: 16,
          flexDirection: "row",
          gap: 10,
          borderTopWidth: 1,
          borderColor: c.border,
        }}
      >
        <View style={{ flex: 1 }}>
          <Button
            variant="secondary"
            disabled={action.pending || state.saving}
            onPress={() => void open("preview")}
          >
            Probar
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            disabled={action.pending || state.saving}
            onPress={() => void open("publish")}
          >
            Publicar
          </Button>
        </View>
      </View>
    </>
  );
}
const creatorText = new WeakMap<object, string>();
export function CreatorScreen() {
  return (
    <Screen keyboard>
      <StudioGate>
        <CreatorView />
      </StudioGate>
    </Screen>
  );
}
function CreatorView() {
  const { store, state } = useStudio(),
    action = useStudioAction(),
    [text, setText] = useState(creatorText.get(store) ?? ""),
    { colors: c } = useTheme(),
    key = useRef(studioKey()),
    scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    void store.library.hydrate();
  }, [store]);
  useEffect(() => {
    creatorText.set(store, text);
  }, [store, text]);
  const send = (message = text) => {
    const value = message;
    void action.run(async () => {
      await store.creator(value, key.current);
      key.current = studioKey();
      setText((t) => (t === value ? "" : t));
      scroll.current?.scrollToEnd({ animated: false });
    });
  };
  const turns = state.studio.creator.turns,
    id = state.studio.creator.agentId;
  return (
    <>
      <StudioBar
        title="Crear agente"
        subtitle="Conversa con el creador"
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/studio")
        }
      />
      {!state.ready ? (
        state.error ? (
          <ErrorState onRetry={() => void store.library.hydrate()} />
        ) : (
          <Skeleton rows={3} />
        )
      ) : (
        <ScrollView
          ref={scroll}
          testID="agent-creator-thread"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 12 }}
        >
          <StudioBubble
            variant="ai"
            who="Creador · simulación"
            meta="ahora"
            text="¡Hola! Cuéntame de tu negocio: qué vendes, a quién y cómo te gusta hablar con tus clientes."
          />
          {turns.map((t) => (
            <React.Fragment key={t.id}>
              <StudioBubble variant="out" meta="ahora" text={t.text} />
              <StudioBubble
                variant="ai"
                who="Creador · simulación"
                meta="ahora"
                text={t.answer}
              />
            </React.Fragment>
          ))}
          {id && (
            <Card style={{ backgroundColor: c.bubbleAi }}>
              <Text weight="semibold">
                {state.studio.agents.find((a) => a.id === id)?.name ??
                  "Borrador"}
              </Text>
              <Text kind="meta">Borrador · 3 secciones</Text>
              <Button
                variant="tonal"
                onPress={() => router.push(`/studio-agent/${id}`)}
              >
                Ver borrador
              </Button>
            </Card>
          )}
          {!!action.error && <Banner type="danger">{action.error}</Banner>}
        </ScrollView>
      )}
      <View style={{ paddingHorizontal: 16 }}>
        <FilterChips
          options={[
            "Hazlo más formal",
            "Agrega horario de sábado",
            "Que pase a persona si piden factura",
          ]}
          value=""
          onChange={(m) => {
            key.current = studioKey();
            send(m);
          }}
        />
      </View>
      <StudioComposer
        label="Mensaje para el creador"
        sendLabel="Enviar al creador"
        value={text}
        onChange={(v) => {
          setText(v);
          key.current = studioKey();
        }}
        onSend={() => send()}
        disabled={action.pending || !state.ready}
      />
    </>
  );
}
