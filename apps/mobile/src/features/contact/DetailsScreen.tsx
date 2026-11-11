import React, { useCallback, useRef } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  Check,
  Clock3,
  DollarSign,
  Flag,
  GitBranch,
  MoreVertical,
  Plus,
  PlugZap,
  Sparkles,
  Tag,
  Target,
  UserCheck,
  UserRound,
  Users,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  AppBar,
  Avatar,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  NavRow,
  Section,
  Skeleton,
  TagCapsule,
  Text,
} from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { useLayers } from "../../components/Layers";
import { useConversation, useInbox } from "../inbox/store";
import { useChatDirectory, useChatState } from "../chat/context";
import { DeleteSheet, useAction } from "../chat/Sheets";
import { WINDOW_MS } from "../chat/model";
import {
  useContactDirectory,
  useContactFlags,
  useContactState,
} from "./context";
import type { ContactStore } from "./core";
import {
  canAssign,
  canChangeMode,
  formatAmount,
  modeLabels,
  personName,
} from "./model";
import { DetailRow, stageColor } from "./Controls";
import { ContactMenuRows, useContactActions } from "./actions";
const backToChat = (id: string) =>
  router.canGoBack() ? router.back() : router.replace(`/conversation/${id}`);
export function DeniedContact() {
  return (
    <Screen>
      <EmptyState
        title="Acceso no permitido"
        message="Esta conversación no está disponible para tu perfil."
        action={
          <Button onPress={() => router.replace("/(tabs)/inbox")}>
            Volver a Bandeja
          </Button>
        }
      />
    </Screen>
  );
}
export function DetailsScreen({ store }: { store: ContactStore }) {
  const s = useContactState(store),
    flags = useContactFlags(),
    conversation = useConversation(store.id)!;
  const chat = useChatDirectory().get(store.id),
    chatState = useChatState(chat);
  const inbox = useInbox(),
    { colors: c } = useTheme(),
    { open, close } = useLayers(),
    actions = useContactActions(store),
    taskAction = useAction();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null),
    focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void chat.hydrate();
      const frame = requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          scroll.current?.scrollTo({ y: store.detailsOffset, animated: false }),
        ),
      );
      return () => {
        focused.current = false;
        cancelAnimationFrame(frame);
      };
    }, [store, chat]),
  );
  const history = () => {
    close();
    router.push(`/history/${store.id}`);
  };
  const more = () =>
    open({
      kind: "menu",
      title: "Opciones del chat",
      content: (
        <>
          <ContactMenuRows store={store} history={history} />
          <NavRow
            label={conversation.archived ? "Recuperar chat" : "Archivar chat"}
            onPress={() => {
              inbox.repository.archive(inbox.actor, [store.id]);
              inbox.reload();
              close();
              router.replace("/(tabs)/inbox");
            }}
          />
          {store.actor.role !== "advisor" && (
            <NavRow
              label="Eliminar chat…"
              onPress={() =>
                open({
                  kind: "dialog",
                  title: "¿Eliminar este chat?",
                  content: (
                    <DeleteSheet
                      chat={chat}
                      onDeleted={() => router.replace("/(tabs)/inbox")}
                    />
                  ),
                })
              }
            />
          )}
          <NavRow label="Pruebas de detalles" onPress={actions.demo} />
        </>
      ),
    });
  const windowText = chat.isOpen()
    ? `Abierta · ${Math.max(1, Math.ceil((chatState.lastIncomingAt + WINDOW_MS - Date.now()) / 3600000))} h`
    : "Cerrada";
  const info = () =>
    open({
      kind: "sheet",
      title: "Ficha del contacto",
      content: (
        <>
          <Text weight="semibold">{conversation.name}</Text>
          <Text>{conversation.phone || "Grupo de WhatsApp"}</Text>
          <Text>
            {store.id === "demo-conv-1"
              ? "karla.mendez@ejemplo.mx"
              : "Sin correo"}
          </Text>
          <Text>Canal · WhatsApp</Text>
          <Text>Consentimiento · Opt-in de demostración</Text>
          <Button onPress={close}>Cerrar ficha</Button>
        </>
      ),
    });
  return (
    <Screen>
      <AppBar
        title="Detalles"
        onBack={() => backToChat(store.id)}
        actions={
          <IconButton
            icon={MoreVertical}
            label="Más opciones del contacto"
            onPress={more}
          />
        }
      />
      {s.view === "offline" && (
        <View style={{ paddingHorizontal: 16 }}>
          <Banner type="warning">
            Sin conexión · Conservamos los detalles cargados
          </Banner>
          <Button variant="ghost" onPress={() => store.view("normal")}>
            Reconectar detalles
          </Button>
        </View>
      )}
      {!s.ready || s.view === "loading" ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {s.error ? (
            <>
              <Banner type="danger">{s.error}</Banner>
              <Button onPress={() => void store.hydrate()}>
                Reintentar detalles
              </Button>
            </>
          ) : (
            <>
              <Skeleton rows={5} />
              {s.ready && (
                <Button onPress={() => store.view("normal")}>
                  Finalizar carga simulada
                </Button>
              )}
            </>
          )}
        </ScrollView>
      ) : s.view === "error" ? (
        <ErrorState onRetry={() => store.view("normal")} />
      ) : s.view === "empty" ? (
        <EmptyState
          title="Sin detalles"
          message="No hay detalles adicionales para mostrar."
          action={
            <Button variant="secondary" onPress={() => store.view("normal")}>
              Volver a los detalles
            </Button>
          }
        />
      ) : (
        <ScrollView
          ref={scroll}
          testID="contact-details"
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={100}
          onScroll={(e) => {
            if (focused.current)
              store.detailsOffset = e.nativeEvent.contentOffset.y;
          }}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        >
          <View
            style={{
              alignItems: "center",
              gap: 8,
              paddingTop: 4,
              paddingBottom: 14,
            }}
          >
            <View
              style={{
                width: 80,
                height: 80,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {conversation.group ? (
                <View
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 40,
                    backgroundColor: c.wash,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Users size={40} color={c.accentInk} />
                </View>
              ) : (
                <View style={{ transform: [{ scale: 1.6 }] }}>
                  <Avatar name={conversation.name} />
                </View>
              )}
            </View>
            <Text weight="semibold" style={{ fontSize: 20, lineHeight: 28 }}>
              {conversation.name}
            </Text>
            <Text kind="secondary" style={{ color: c.text3 }}>
              {conversation.group ? "Grupo de WhatsApp" : conversation.phone} ·{" "}
              {windowText}
            </Text>
          </View>
          {store.id === "demo-conv-1" && (
            <Card
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <Target size={24} color={c.text2} />
              <View>
                <Text weight="semibold">Llegó por anuncio</Text>
                <Text kind="meta" style={{ color: c.text3 }}>
                  Anuncio · Promo nov
                </Text>
              </View>
            </Card>
          )}
          <Card style={{ padding: 0, gap: 0 }}>
            <DetailRow
              icon={GitBranch}
              label="Etapa"
              value={conversation.stage}
              valueDot={stageColor(conversation.stage)}
              onPress={actions.stage}
            />
            <View style={{ height: 1, backgroundColor: c.border }} />
            <DetailRow
              icon={UserCheck}
              label="Asignado"
              value={personName(conversation.assigned)}
              onPress={canAssign(store.actor) ? actions.assign : undefined}
            />
            <View style={{ height: 1, backgroundColor: c.border }} />
            <DetailRow
              icon={Tag}
              label="Etiquetas"
              value={
                conversation.tags.length
                  ? `${conversation.tags.length} etiqueta${conversation.tags.length === 1 ? "" : "s"}`
                  : "Sin etiquetas"
              }
              onPress={actions.tags}
            />
          </Card>
          {!!conversation.tags.length && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {conversation.tags.map((tag) => (
                <TagCapsule key={tag}>{tag}</TagCapsule>
              ))}
            </View>
          )}
          <Card style={{ padding: 0, gap: 0 }}>
            <DetailRow
              icon={Sparkles}
              label={
                conversation.group ? "IA en este grupo" : "IA en este chat"
              }
              value={
                { on: "Atiende la IA", pause: "En pausa", off: "Apagada" }[
                  conversation.ai
                ]
              }
              onPress={actions.ai}
            />
            {canChangeMode(store.actor, conversation, flags) && (
              <DetailRow
                icon={PlugZap}
                label="Conexión del chat"
                value={modeLabels[s.data.mode]}
                onPress={actions.connection}
              />
            )}
          </Card>
          {!conversation.group && (
            <>
              <Section>Venta</Section>
              <Card style={{ padding: 0, gap: 0 }}>
                <DetailRow
                  icon={DollarSign}
                  label="Monto"
                  value={formatAmount(s.data.amountCents)}
                  onPress={actions.amount}
                />
                <View style={{ height: 1, backgroundColor: c.border }} />
                <DetailRow
                  icon={Flag}
                  label="Prioridad"
                  value={s.data.priority}
                  onPress={actions.priority}
                />
              </Card>
            </>
          )}
          <Section>Tareas de este chat</Section>
          <Card style={{ padding: 0, gap: 0 }}>
            {s.data.tasks.length ? (
              s.data.tasks.map((t) => (
                <Pressable
                  key={t.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={t.title}
                  accessibilityState={{
                    checked: t.done,
                    disabled:
                      s.saving ||
                      (store.actor.role === "advisor" &&
                        t.assignee !== store.actor.id),
                  }}
                  aria-checked={t.done}
                  disabled={
                    s.saving ||
                    (store.actor.role === "advisor" &&
                      t.assignee !== store.actor.id)
                  }
                  onPress={() =>
                    void taskAction.run(() => store.toggleTask(t.id))
                  }
                  style={{
                    minHeight: 60,
                    padding: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderWidth: 2,
                      borderColor: t.done ? c.accent : c.borderStrong,
                      borderRadius: 5,
                      backgroundColor: t.done ? c.accent : c.surface,
                    }}
                  >
                    {t.done && <Check size={18} color={c.onAccent} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        textDecorationLine: t.done ? "line-through" : "none",
                      }}
                    >
                      {t.title}
                    </Text>
                    <Text kind="meta" style={{ color: c.text3 }}>
                      {new Date(t.due).toLocaleString("es-MX", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {personName(t.assignee)}
                    </Text>
                  </View>
                </Pressable>
              ))
            ) : (
              <Text kind="secondary" style={{ color: c.text3, padding: 16 }}>
                Sin tareas para este chat.
              </Text>
            )}
            <DetailRow
              icon={Plus}
              label="Nueva tarea para este chat"
              onPress={actions.task}
            />
          </Card>
          {taskAction.error && (
            <Banner type="danger">{taskAction.error}</Banner>
          )}
          <Section>Más detalles</Section>
          <Card>
            {[
              ["Teléfono", conversation.phone || "—"],
              [
                "Correo",
                store.id === "demo-conv-1" ? "karla.mendez@ejemplo.mx" : "—",
              ],
              ["Consentimiento", "Opt-in"],
              ["Canal", "WhatsApp"],
            ].map(([k, v]) => (
              <View
                key={k}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <Text kind="secondary" style={{ color: c.text3 }}>
                  {k}
                </Text>
                <Text
                  kind="secondary"
                  selectable
                  style={{ flexShrink: 1, textAlign: "right" }}
                >
                  {v}
                </Text>
              </View>
            ))}
          </Card>
          <Card style={{ padding: 0, gap: 0 }}>
            <DetailRow icon={Clock3} label="Ver historial" onPress={history} />
            <DetailRow
              icon={UserRound}
              label="Abrir ficha del contacto"
              onPress={info}
            />
          </Card>
        </ScrollView>
      )}
    </Screen>
  );
}
export default function ContactPage() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    directory = useContactDirectory();
  const c = useConversation(id ?? "");
  if (!c) return <DeniedContact />;
  let store: ContactStore;
  try {
    store = directory.get(id);
  } catch {
    return <DeniedContact />;
  }
  return <DetailsScreen key={id} store={store} />;
}
