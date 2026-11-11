import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Pressable, ScrollView, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import {
  ArrowLeft,
  ArrowDown,
  Hand,
  MoreVertical,
  Paperclip,
  Phone,
  Send,
  Smile,
  WandSparkles,
  Zap,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  AppBar,
  Avatar,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  NavRow,
  Skeleton,
  Text,
} from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { useInbox, useConversation } from "../inbox/store";
import { useContactDirectory } from "../contact/context";
import { ContactMenuRows } from "../contact/actions";
import { ChatStore } from "./core";
import { useChatDirectory, useChatState } from "./context";
import { CHAT_TEXT_MAX, quickReplies, type Message } from "./model";
import { ConversationBubble } from "./Bubble";
import {
  AttachmentSheet,
  ChatDemoSheet,
  DeleteSheet,
  EmojiSheet,
  LibrarySheet,
  QuickSheet,
  RewriteSheet,
  TemplateSheet,
  useAction,
} from "./Sheets";
const messageKey = (m: Message) => m.id;
const messageType = (m: Message) => (m.attachment ? "media" : m.sender);
const back = () =>
  router.canGoBack() ? router.back() : router.replace("/(tabs)/inbox");
export function ConversationScreen({ chat }: { chat: ChatStore }) {
  const s = useChatState(chat);
  const conversation = useConversation(chat.conversationId)!;
  const contact = useContactDirectory().get(chat.conversationId);
  useEffect(() => {
    void contact.hydrate();
  }, [contact]);
  const taken =
    s.taken &&
    conversation.ai === "pause" &&
    conversation.assigned === chat.actor.id;
  const inbox = useInbox();
  const { colors: c } = useTheme();
  const { open, close, toast } = useLayers();
  const action = useAction();
  const list = useRef<FlashListRef<Message>>(null);
  const focused = useRef(false);
  const ready = useRef(false);
  const atBottom = useRef(true);
  const [newCount, setNewCount] = useState(0);
  const [undo, setUndo] = useState<string | null>(null);
  const [resume, setResume] = useState({ epoch: 0, index: 0, within: 0 });
  const previousLast = useRef<string | undefined>(undefined);
  useEffect(() => {
    void chat.hydrate();
  }, [chat]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      const anchor = chat.anchor;
      if (anchor) {
        const index = chat
          .snapshot()
          .messages.findIndex((m) => m.id === anchor.id);
        if (index >= 0) {
          ready.current = false;
          setResume((v) => ({
            epoch: v.epoch + 1,
            index,
            within: anchor.within,
          }));
        }
      }
      const tick = () => chat.tick();
      const interval = setInterval(() => {
        if (AppState.currentState === "active") tick();
      }, 15000);
      const app = AppState.addEventListener("change", (state) => {
        if (state === "active") tick();
        else void chat.flushDraft().catch(() => {});
      });
      return () => {
        focused.current = false;
        clearInterval(interval);
        app.remove();
        void chat.flushDraft().catch(() => {});
      };
    }, [chat]),
  );
  const positionPolicy = useMemo(
    () => ({
      startRenderingFromBottom: resume.epoch === 0,
      autoscrollToBottomThreshold: 0.15,
      animateAutoScrollToBottom: false,
    }),
    [resume.epoch],
  );
  const locked = !chat.isOpen();
  const paused = s.view === "loading" || s.view === "error";
  const days = useMemo(() => {
    let previous = "";
    return s.messages.map((m) => {
      const date = new Date(m.time);
      const key = date.toDateString();
      const label =
        key === previous
          ? ""
          : key === new Date().toDateString()
            ? "Hoy"
            : date.toLocaleDateString("es-MX", {
                day: "numeric",
                month: "short",
              });
      previous = key;
      return label;
    });
  }, [s.messages]);
  const captureAnchor = useCallback(() => {
    const ref = list.current;
    if (ref) {
      const index = ref.getFirstVisibleIndex();
      const layout = ref.getLayout(index);
      const message = ref.props.data?.[index];
      if (layout && message)
        chat.anchor = {
          id: message.id,
          index,
          within:
            ref.getAbsoluteLastScrollOffset() -
            layout.y -
            ref.getFirstItemOffset(),
        };
    }
  }, [chat]);
  const toBottom = useCallback(() => {
    chat.anchor = null;
    list.current?.scrollToEnd({ animated: false });
    setNewCount(0);
  }, [chat]);
  useEffect(() => {
    const last = s.messages.at(-1);
    if (previousLast.current && last && last.id !== previousLast.current) {
      if (last.sender === "team" || atBottom.current) {
        const frame = requestAnimationFrame(toBottom);
        previousLast.current = last.id;
        return () => cancelAnimationFrame(frame);
      }
      setNewCount((n) => n + 1);
    }
    previousLast.current = last?.id;
  }, [s.messages, toBottom]);
  const template = useCallback(
    () =>
      open({
        kind: "sheet",
        title: "Enviar plantilla",
        content: <TemplateSheet chat={chat} name={conversation.name} />,
      }),
    [chat, conversation.name, open],
  );
  const library = useCallback(
    () =>
      open({
        kind: "sheet",
        title: "Enviar de la Biblioteca",
        content: <LibrarySheet chat={chat} />,
      }),
    [chat, open],
  );
  const attachments = () =>
    open({
      kind: "sheet",
      title: "Adjuntar",
      content: <AttachmentSheet chat={chat} onLibrary={library} />,
    });
  const quick = () =>
    open({
      kind: "sheet",
      title: "Respuestas rápidas",
      content: <QuickSheet chat={chat} name={conversation.name} />,
    });
  const insert = (value: string) => {
    void action.run(() => {
      chat.setDraft(chat.snapshot().draft + value);
      setUndo(null);
    });
  };
  const rewrite = () =>
    open({
      kind: "sheet",
      title: "Asistente de redacción",
      content: (
        <RewriteSheet
          chat={chat}
          onApply={(text) => {
            setUndo(chat.snapshot().draft);
            chat.setDraft(text);
          }}
        />
      ),
    });
  const onRetry = useCallback(
    (id: string) => void action.run(() => chat.retry(id)),
    [chat, action.run],
  );
  const onFull = useCallback(
    (id: string) => {
      const m = chat.snapshot().messages.find((m) => m.id === id);
      if (m)
        open({
          kind: "sheet",
          title: "Mensaje completo",
          content: <Text selectable>{m.text}</Text>,
        });
    },
    [chat, open],
  );
  const onMedia = useCallback(
    (id: string) => {
      const m = chat.snapshot().messages.find((m) => m.id === id);
      if (m?.attachment?.kind === "image") {
        captureAnchor();
        router.push(
          `/media/${encodeURIComponent(id)}?conversation=${conversation.id}`,
        );
      } else if (m?.attachment)
        open({
          kind: "dialog",
          title: m.attachment.name,
          content: (
            <>
              <Text>
                Contenido de muestra ·{" "}
                {m.attachment.kind === "video"
                  ? "Video simulado, sin reproducción de un archivo real."
                  : m.attachment.kind === "location"
                    ? "Ubicación ficticia, sin acceso al GPS."
                    : m.attachment.kind === "contact"
                      ? "Contacto ficticio, sin acceso a la agenda."
                      : "Documento ficticio, sin leer archivos del teléfono."}
              </Text>
              <Button onPress={close}>Entendido</Button>
            </>
          ),
        });
    },
    [chat, conversation.id, open, close, captureAnchor],
  );
  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => (
      <ConversationBubble
        message={item}
        day={days[index] ?? ""}
        locked={locked}
        onRetry={onRetry}
        onMedia={onMedia}
        onFull={onFull}
        onTemplate={template}
      />
    ),
    [days, locked, onRetry, onMedia, onFull, template],
  );
  const menu = () =>
    open({
      kind: "menu",
      title: "Opciones del chat",
      content: (
        <>
          <ContactMenuRows
            store={contact}
            details={() => {
              captureAnchor();
              close();
              router.push(`/contact/${conversation.id}`);
            }}
            history={() => {
              captureAnchor();
              close();
              router.push(`/history/${conversation.id}`);
            }}
          />
          <NavRow
            label="Mensajes anteriores"
            onPress={() => {
              close();
              void chat.loadOlder();
            }}
          />
          <NavRow label="Enviar plantilla" onPress={template} />
          {!locked && <NavRow label="Adjuntar" onPress={attachments} />}
          <NavRow
            label="Archivar chat"
            onPress={() => {
              inbox.repository.archive(inbox.actor, [conversation.id]);
              inbox.reload();
              close();
              back();
            }}
          />
          {chat.actor.role !== "advisor" && (
            <NavRow
              label="Eliminar chat…"
              onPress={() =>
                open({
                  kind: "dialog",
                  title: "¿Eliminar este chat?",
                  content: <DeleteSheet chat={chat} onDeleted={back} />,
                })
              }
            />
          )}
          <NavRow
            label="Pruebas de chat"
            onPress={() =>
              open({
                kind: "sheet",
                title: "Simulación del chat",
                content: <ChatDemoSheet chat={chat} />,
              })
            }
          />
        </>
      ),
    });
  const slash = s.draft.startsWith("/")
    ? quickReplies.filter((q) =>
        `/${q.shortcut}`.startsWith(s.draft.toLowerCase()),
      )
    : [];
  return (
    <Screen keyboard>
      <View
        style={{
          minHeight: 64,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 4,
          gap: 4,
        }}
      >
        <IconButton icon={ArrowLeft} label="Volver a Bandeja" onPress={back} />
        <View
          style={{
            width: 40,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View style={{ transform: [{ scale: 0.8 }] }}>
            <Avatar name={conversation.name} />
            <View
              accessibilityLabel={
                taken
                  ? "Atención humana"
                  : conversation.ai === "on"
                    ? "IA activa"
                    : conversation.ai === "pause"
                      ? "IA pausada"
                      : "Atención humana"
              }
              style={{
                position: "absolute",
                right: -2,
                bottom: 3,
                width: 14,
                height: 14,
                borderRadius: 7,
                borderWidth: 3,
                borderColor: c.surface,
                backgroundColor:
                  taken || conversation.ai === "off"
                    ? c.text3
                    : conversation.ai === "pause"
                      ? c.warning
                      : c.success,
              }}
            />
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Detalles de ${conversation.name}`}
          onPress={() => {
            captureAnchor();
            router.push(`/contact/${conversation.id}`);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            paddingLeft: 4,
            minHeight: 48,
            justifyContent: "center",
          }}
        >
          <Text
            accessibilityRole="header"
            kind="title"
            weight="semibold"
            numberOfLines={1}
          >
            {conversation.name}
          </Text>
          <Text kind="meta" numberOfLines={1} style={{ color: c.text3 }}>
            <Text
              kind="meta"
              style={{
                color:
                  conversation.stage === "Interesado"
                    ? c.warning
                    : conversation.stage === "Cliente"
                      ? c.success
                      : c.accentInk,
              }}
            >
              ●{" "}
            </Text>
            {conversation.stage} ·{" "}
            {taken
              ? "Tú"
              : conversation.assigned === "demo-advisor"
                ? "Luis Ortega"
                : conversation.assigned === "demo-coordinator"
                  ? "Ana López"
                  : conversation.assigned
                    ? "Fer Ramírez"
                    : "Sin asignar"}
          </Text>
        </Pressable>
        <IconButton
          icon={Phone}
          label="Llamar"
          onPress={() => toast(`Marcador simulado · ${conversation.phone}`)}
        />
        <IconButton
          icon={MoreVertical}
          label="Opciones del chat"
          onPress={menu}
        />
      </View>
      {(!!action.error || !!s.error) && s.ready && (
        <View style={{ paddingHorizontal: 12 }}>
          <Banner type="danger">{action.error || s.error}</Banner>
        </View>
      )}
      {!!s.pageError && (
        <View style={{ paddingHorizontal: 12 }}>
          <Banner type="danger">{s.pageError}</Banner>
          <Button variant="ghost" onPress={() => void chat.loadOlder()}>
            Reintentar página
          </Button>
        </View>
      )}
      {s.view === "offline" && (
        <View style={{ paddingHorizontal: 12 }}>
          <Banner type="warning">
            Sin conexión · Conservamos el historial cargado
          </Banner>
          <Button variant="ghost" onPress={chat.reconnect}>
            Reconectar simulación
          </Button>
        </View>
      )}
      <View style={{ flex: 1, backgroundColor: c.sunken }}>
        {!s.ready || s.view === "loading" ? (
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {!!s.error ? (
              <>
                <Banner type="danger">{s.error}</Banner>
                <Button onPress={() => void chat.hydrate()}>
                  Reintentar carga local
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onPress={() => chat.setView("normal")}
                  disabled={!s.ready}
                >
                  Finalizar carga simulada
                </Button>
                <Skeleton rows={5} />
              </>
            )}
          </ScrollView>
        ) : s.view === "error" ? (
          <ErrorState onRetry={() => chat.setView("normal")} />
        ) : (
          <FlashList
            ref={list}
            key={resume.epoch}
            testID="message-list"
            accessibilityLabel={`Historial: ${s.messages.length} mensajes cargados`}
            data={s.view === "empty" ? [] : s.messages}
            keyExtractor={messageKey}
            getItemType={messageType}
            renderItem={renderItem}
            drawDistance={400}
            maintainVisibleContentPosition={positionPolicy}
            initialScrollIndex={resume.epoch ? resume.index : undefined}
            initialScrollIndexParams={{ viewOffset: resume.within }}
            onLoad={() => {
              ready.current = true;
            }}
            onScroll={(event) => {
              if (!focused.current || !ready.current) return;
              const e = event.nativeEvent;
              atBottom.current =
                e.contentSize.height -
                  e.contentOffset.y -
                  e.layoutMeasurement.height <
                72;
              if (atBottom.current) setNewCount((n) => (n ? 0 : n));
              captureAnchor();
            }}
            scrollEventThrottle={100}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}
            ListHeaderComponent={
              <View style={{ padding: 12, gap: 8 }}>
                {s.hasMore && (
                  <Button
                    variant="ghost"
                    loading={s.paging}
                    onPress={() => void chat.loadOlder()}
                  >
                    Cargar mensajes anteriores
                  </Button>
                )}
              </View>
            }
            ListEmptyComponent={
              <View style={{ padding: 20 }}>
                <EmptyState
                  title="Sin mensajes"
                  message="Aquí aparecerán los mensajes de esta conversación ficticia."
                />
              </View>
            }
          />
        )}{" "}
        {!!newCount && (
          <View
            style={{
              position: "absolute",
              bottom: 8,
              right: 12,
              backgroundColor: c.surface,
              borderRadius: 12,
            }}
          >
            <Button
              variant="tonal"
              icon={ArrowDown}
              onPress={toBottom}
            >{`${newCount} mensajes nuevos`}</Button>
          </View>
        )}
      </View>
      {conversation.ai === "pause" && !taken && (
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 4,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: c.base,
          }}
        >
          <Hand size={22} color={c.warning} />
          <Text kind="secondary" style={{ flex: 1, color: c.warning }}>
            La IA pasó este chat a una persona.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void action.run(async () => {
                await contact.take();
                chat.take();
              })
            }
            style={{ minHeight: 48, justifyContent: "center" }}
          >
            <Text
              weight="semibold"
              style={{ color: c.warning, textDecorationLine: "underline" }}
            >
              Tomar chat
            </Text>
          </Pressable>
        </View>
      )}
      {!s.ready ? null : locked ? (
        <View style={{ padding: 12, gap: 8 }}>
          <Banner type="warning">
            La ventana de 24 horas está cerrada. Solo puedes enviar una
            plantilla aprobada.
          </Banner>
          <Button onPress={template}>Enviar plantilla</Button>
        </View>
      ) : (
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            backgroundColor: c.sunken,
            gap: 4,
          }}
        >
          {slash.length > 0 && (
            <Button
              variant="tonal"
              onPress={quick}
            >{`/${slash[0]!.shortcut} · Respuestas rápidas`}</Button>
          )}
          {s.draftError && (
            <>
              <Banner type="danger">{s.draftError}</Banner>
              <Button
                variant="ghost"
                onPress={() => void action.run(chat.retryDraft)}
              >
                Reintentar guardado
              </Button>
            </>
          )}
          {undo !== null && (
            <Button
              variant="ghost"
              onPress={() => {
                chat.setDraft(undo);
                setUndo(null);
              }}
            >
              Deshacer redacción
            </Button>
          )}
          <View
            style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}
          >
            <View
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "flex-end",
                borderRadius: 24,
                borderWidth: 1,
                borderColor: c.borderStrong,
                backgroundColor: c.surface,
                padding: 2,
              }}
            >
              <IconButton
                icon={Smile}
                label="Emojis"
                onPress={() =>
                  open({
                    kind: "sheet",
                    title: "Emojis",
                    content: <EmojiSheet onInsert={insert} />,
                  })
                }
              />
              <TextInput
                accessibilityLabel="Mensaje"
                placeholder="Mensaje"
                placeholderTextColor={c.text3}
                value={s.draft}
                onChangeText={(value) => {
                  chat.setDraft(value);
                  setUndo(null);
                }}
                multiline
                maxLength={CHAT_TEXT_MAX}
                submitBehavior="newline"
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 48,
                  maxHeight: 120,
                  paddingVertical: 12,
                  fontFamily: "Inter_400Regular",
                  fontSize: 15,
                  color: c.text,
                }}
              />
              <IconButton
                icon={s.draft ? WandSparkles : Zap}
                label={
                  s.draft ? "Asistente de redacción" : "Respuestas rápidas"
                }
                onPress={s.draft ? rewrite : quick}
              />
              <IconButton
                icon={Paperclip}
                label="Adjuntar"
                onPress={attachments}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar mensaje"
              accessibilityState={{
                disabled: !s.draft.trim() || s.busy > 0 || paused,
              }}
              aria-disabled={!s.draft.trim() || s.busy > 0 || paused}
              disabled={!s.draft.trim() || s.busy > 0 || paused}
              onPress={() => void action.run(() => chat.sendDraft())}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: c.accent,
                opacity: !s.draft.trim() || s.busy ? 0.45 : 1,
              }}
            >
              <Send size={24} color={c.onAccent} />
            </Pressable>
          </View>
        </View>
      )}
    </Screen>
  );
}
export default function ChatPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const directory = useChatDirectory();
  const contacts = useContactDirectory();
  const scopedConversation = useConversation(id ?? "");
  let chat: ChatStore;
  try {
    if (!scopedConversation) throw new Error("Acceso no permitido");
    chat = directory.get(id ?? "");
    contacts.get(id ?? "");
  } catch (error) {
    return (
      <Screen>
        <EmptyState
          title={
            scopedConversation ? "Chat no disponible" : "Acceso no permitido"
          }
          message={
            scopedConversation && error instanceof Error
              ? error.message
              : "Esta conversación no está disponible para tu perfil."
          }
          action={
            <Button onPress={() => router.replace("/(tabs)/inbox")}>
              Volver a Bandeja
            </Button>
          }
        />
      </Screen>
    );
  }
  return <ConversationScreen key={id} chat={chat} />;
}
