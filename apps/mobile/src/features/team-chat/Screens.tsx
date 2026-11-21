import { AreaHeader, AreaTabsSlot } from "../inbox/AreaTabs";
import React, { useState, useRef, useEffect, useMemo } from "react";
import { FlatList, View, Pressable, TextInput } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  AtSign,
  Paperclip,
  Plus,
  MoreVertical,
  Users,
  Megaphone,
  Send,
  ArrowLeft,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  AppBar,
  IconButton,
  SegmentedControl,
} from "../../components/ModuleUi";
import {
  Avatar,
  Banner,
  Button,
  Choice,
  EmptyState,
  ErrorState,
  Field,
  NavRow,
  PageScroll,
  SearchBox,
  Section,
  Skeleton,
  Switch,
  Text,
} from "../../components/ui";
import { StudioBar } from "../studio/StudioBar";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { usePeople } from "../team/state";
import { useInbox, useInboxState } from "../inbox/store";
import { catalogKey } from "../catalog/core";
import { useInternal } from "./state";
import type { TeamChatStore, Message, Room } from "./core";
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
const go = (id: string) => router.push(`/internal-chat/${id}`);
function RoomAvatar({ room, title }: { room: Room; title: string }) {
  const { colors: c } = useTheme();
  if (room.kind === "direct") return <Avatar name={title} />;
  const Icon = room.kind === "announcements" ? Megaphone : Users;
  return (
    <View
      style={{
        width: 50,
        height: 50,
        borderRadius: 25,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c.wash,
      }}
    >
      <Icon
        size={24}
        color={room.kind === "announcements" ? c.warning : c.accentInk}
      />
    </View>
  );
}
function InternalBar({
  store,
  room,
  onBack,
  info = false,
}: {
  store: TeamChatStore;
  room: Room;
  onBack: () => void;
  info?: boolean;
}) {
  const title = store.title(room);
  return (
    <View
      style={{
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 4,
      }}
    >
      <IconButton icon={ArrowLeft} label="Atrás" onPress={onBack} />
      <RoomAvatar room={room} title={title} />
      <View style={{ flex: 1 }}>
        <Text
          accessibilityRole="header"
          kind="title"
          weight="semibold"
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text kind="meta">
          {room.kind === "group"
            ? `${room.members.length} participantes`
            : room.kind === "announcements"
              ? "Solo coordinación publica"
              : "Conversación directa"}
        </Text>
      </View>
      {!info && (
        <IconButton
          icon={MoreVertical}
          label="Información de la conversación"
          disabled={store.supervised(room.id)}
          onPress={() => router.push(`/internal-info/${room.id}`)}
        />
      )}
    </View>
  );
}
function Ready({ children }: React.PropsWithChildren) {
  const { store, state } = useInternal(),
    status = useInboxState().status,
    inbox = useInbox();
  return !state.ready ? (
    state.error ? (
      <ErrorState onRetry={() => void store.reload()} />
    ) : (
      <Skeleton rows={4} />
    )
  ) : status === "loading" ? (
    <Skeleton rows={4} />
  ) : status === "error" ? (
    <ErrorState
      onRetry={() => {
        inbox.patch({ status: "normal" });
        void store.reload();
      }}
    />
  ) : (
    <>
      {status === "offline" && (
        <Banner type="warning">
          Sin conexión · mensajes internos locales.
        </Banner>
      )}
      {children}
    </>
  );
}
export function InternalList() {
  const { store, state } = useInternal(),
    [query, setQuery] = useState(""),
    layers = useLayers(),
    status = useInboxState().status;
  const rows =
    state.ready && status !== "empty"
      ? store
          .list()
          .filter((r) =>
            store.title(r).toLowerCase().includes(query.toLowerCase()),
          )
      : [];
  return (
    <Screen>
      <AreaHeader>
        <AppBar
          module
          title="Bandeja"
          actions={
            <IconButton
              icon={Plus}
              label="Nuevo mensaje"
              onPress={() =>
                layers.open({
                  kind: "sheet",
                  title: "Nuevo mensaje",
                  content: <NewMessage />,
                })
              }
            />
          }
        />
      </AreaHeader>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}>
        <AreaTabsSlot area="team" />
      </View>
      <Ready>
        {state.ready && store.permittedSupervision() && (
          <NavRow
            label="Supervisión"
            onPress={() =>
              layers.open({
                kind: "sheet",
                title: "Supervisión",
                content: <SupervisionRooms />,
              })
            }
          />
        )}
        <View style={{ paddingHorizontal: 16 }}>
          <SearchBox
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar persona o grupo"
            accessibilityLabel="Buscar persona o grupo"
          />
        </View>
        <FlatList
          contentContainerStyle={{ paddingBottom: 112 }}
          data={rows}
          keyExtractor={(r) => r.id}
          ListFooterComponent={
            <Text kind="meta" style={{ padding: 16 }}>
              Conversaciones internas: nada de aquí sale a WhatsApp.
            </Text>
          }
          ListEmptyComponent={
            <EmptyState
              title="Aún no hay conversaciones"
              message="Escribe a una persona de tu equipo o crea un grupo."
            />
          }
          renderItem={({ item: r }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Abrir ${store.title(r)}`}
              onPress={() => go(r.id)}
              style={{
                minHeight: 80,
                padding: 16,
                flexDirection: "row",
                gap: 12,
              }}
            >
              <RoomAvatar room={r} title={store.title(r)} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text weight="medium">{store.title(r)}</Text>
                <Text kind="meta" numberOfLines={1}>
                  {store.messages(r.id).at(-1)?.text ?? "Sin mensajes"}
                </Text>
              </View>
            </Pressable>
          )}
        />
      </Ready>
    </Screen>
  );
}
function NewMessage() {
  const { store } = useInternal(),
    { team } = usePeople(),
    [query, setQuery] = useState(""),
    [group, setGroup] = useState(false),
    [name, setName] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    action = useAction(),
    { close } = useLayers(),
    key = useRef(catalogKey());
  const people = team.filter(
    (p) =>
      p.id !== store.actorId &&
      p.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <SearchBox
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar persona"
        accessibilityLabel="Buscar persona"
      />
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      {people.map((p) =>
        group ? (
          <Choice
            key={p.id}
            label={p.name}
            checked={selected.includes(p.id)}
            onPress={() =>
              setSelected((s) =>
                s.includes(p.id) ? s.filter((id) => id !== p.id) : [...s, p.id],
              )
            }
          />
        ) : (
          <NavRow
            key={p.id}
            label={p.name}
            onPress={() =>
              void action.run(async () => {
                const id = await store.create([p.id], null, key.current);
                close();
                go(id);
              })
            }
          />
        ),
      )}
      {store.canCreateGroups() && !group && (
        <Button variant="tonal" onPress={() => setGroup(true)}>
          Nuevo grupo
        </Button>
      )}
      {group && !store.canCreateGroups() && (
        <Banner type="warning">Se retiró el permiso para crear grupos.</Banner>
      )}
      {group && store.canCreateGroups() && (
        <>
          <Field
            label="Nombre del grupo"
            value={name}
            onChangeText={setName}
            maxLength={80}
          />
          <Button
            onPress={() =>
              void action.run(async () => {
                const id = await store.create(selected, name, key.current);
                close();
                go(id);
              })
            }
          >
            Crear grupo
          </Button>
        </>
      )}
    </>
  );
}
const drafts = new WeakMap<TeamChatStore, Map<string, string>>();
export function InternalChat() {
  const { id, supervise } = useLocalSearchParams<{
      id: string;
      supervise?: string;
    }>(),
    { store, state } = useInternal();
  useEffect(() => {
    if (supervise !== "1") store.clearSupervision();
  }, [store, supervise, id]);
  return (
    <Screen keyboard>
      <Ready>
        {state.ready && <ChatBody key={id} store={store} id={id} />}
      </Ready>
    </Screen>
  );
}
function ChatBody({ store, id }: { store: TeamChatStore; id: string }) {
  let room;
  try {
    room = store.get(id);
  } catch {
    return (
      <EmptyState
        title="Acceso no permitido"
        message="No perteneces a esta conversación."
      />
    );
  }
  return <ChatContent store={store} id={id} />;
}
function ChatContent({ store, id }: { store: TeamChatStore; id: string }) {
  const room = store.get(id),
    { personName } = usePeople(),
    inbox = useInbox(),
    { colors: c, fontFamily } = useTheme(),
    layers = useLayers(),
    action = useAction(),
    list = useRef<FlatList<Message>>(null),
    followLatest = useRef(true),
    [text, setText] = useState(drafts.get(store)?.get(id) ?? ""),
    [attachment, setAttachment] = useState<
      { name: string; bytes: number } | undefined
    >(),
    [client, setClient] = useState<string | undefined>(),
    key = useRef(catalogKey());
  const readOnly =
    store.supervised(id) ||
    (room.kind === "announcements" && !store.canPublishAnnouncements());
  const messages = useMemo(
    () => store.messages(id),
    [store, id, store.snapshot().doc.messages],
  );
  const draftValue = useRef(text);
  draftValue.current = text;
  const [draftReady, setDraftReady] = useState(
      drafts.get(store)?.has(id) ?? false,
    ),
    [draftError, setDraftError] = useState("");
  useEffect(() => {
    if (!draftReady || readOnly) return;
    let d = drafts.get(store);
    if (!d) {
      d = new Map();
      drafts.set(store, d);
    }
    d.set(id, text);
  }, [store, id, text, draftReady, readOnly]);
  useEffect(() => {
    if (draftReady || readOnly) return;
    let live = true;
    void store
      .draft(id)
      .then((v) => {
        if (live) {
          setText(v);
          setDraftReady(true);
        }
      })
      .catch(() => {
        if (live) setDraftError("No se pudo recuperar el borrador local.");
      });
    return () => {
      live = false;
    };
  }, [store, id, draftReady, readOnly]);
  useEffect(() => {
    if (!draftReady || readOnly) return;
    const t = setTimeout(() => {
      if (draftValue.current !== text) return;
      void store
        .saveDraft(id, text)
        .then(() => setDraftError(""))
        .catch(() => setDraftError("No se pudo guardar el borrador local."));
    }, 350);
    return () => clearTimeout(t);
  }, [store, id, text, draftReady, readOnly]);
  return (
    <>
      <InternalBar
        store={store}
        room={room}
        onBack={() =>
          router.canGoBack()
            ? router.back()
            : router.replace("/(tabs)/inbox?area=team")
        }
      />
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      {!!draftError && <Banner type="danger">{draftError}</Banner>}
      <FlatList
        ref={list}
        testID="internal-thread"
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        onScroll={(event) => {
          const e = event.nativeEvent;
          followLatest.current =
            e.contentSize.height -
              e.layoutMeasurement.height -
              e.contentOffset.y <
            80;
        }}
        scrollEventThrottle={32}
        data={messages}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() => {
          if (followLatest.current)
            list.current?.scrollToEnd({ animated: false });
        }}
        style={{ backgroundColor: c.sunken }}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          <EmptyState
            title="Sin mensajes"
            message="Inicia esta conversación interna."
          />
        }
        renderItem={({ item: m }) => (
          <View
            style={{
              alignSelf: m.author === store.actorId ? "flex-end" : "flex-start",
              maxWidth: "90%",
              padding: 12,
              borderRadius: 14,
              backgroundColor:
                m.author === store.actorId ? c.bubbleTeam : c.bubbleIn,
              borderWidth: 1,
              borderColor: c.border,
            }}
          >
            <Text kind="meta">{personName(m.author)}</Text>
            <Text>{m.text}</Text>
            {m.client && (
              <Button
                variant="ghost"
                onPress={() => {
                  try {
                    inbox.repository.get(inbox.actor, m.client!);
                    router.push(`/conversation/${m.client}`);
                  } catch {
                    layers.toast("Chat restringido para tu perfil");
                  }
                }}
              >
                {(() => {
                  try {
                    return inbox.repository.get(inbox.actor, m.client!).name;
                  } catch {
                    return "Chat restringido";
                  }
                })()}
              </Button>
            )}
            {m.attachment && (
              <Button
                variant="ghost"
                onPress={() =>
                  layers.open({
                    kind: "dialog",
                    title: "Vista previa ficticia",
                    content: (
                      <Text>
                        {m.attachment!.name} ·{" "}
                        {(m.attachment!.bytes / 1024).toFixed(0)} KB · Sin
                        archivo real
                      </Text>
                    ),
                  })
                }
              >
                {m.attachment.name}
              </Button>
            )}
            <Text kind="meta">
              {new Date(m.at).toLocaleTimeString("es-MX", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </View>
        )}
      />
      {readOnly ? (
        <Banner>
          {store.supervised(id)
            ? "Supervisión activa · solo lectura"
            : "Solo la coordinación publica en Avisos."}
        </Banner>
      ) : (
        <View style={{ padding: 12, gap: 8 }}>
          {attachment && (
            <Button
              variant="secondary"
              onPress={() => setAttachment(undefined)}
            >{`Quitar adjunto: ${attachment.name}`}</Button>
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
                icon={AtSign}
                label="Mencionar"
                onPress={() =>
                  layers.open({
                    kind: "sheet",
                    title: "Mencionar",
                    content: (
                      <Mentions
                        store={store}
                        select={(name, ref) => {
                          setText((t) => `${t}${t ? " " : ""}${name}`);
                          setClient(ref);
                          layers.close();
                        }}
                      />
                    ),
                  })
                }
              />
              <TextInput
                accessibilityLabel="Mensaje al equipo"
                placeholder="Mensaje"
                placeholderTextColor={c.text3}
                editable={draftReady}
                value={text}
                onChangeText={setText}
                multiline
                submitBehavior="newline"
                maxLength={4000}
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 48,
                  maxHeight: 120,
                  paddingVertical: 12,
                  fontFamily: fontFamily(),
                  fontSize: 15,
                  color: c.text,
                }}
              />
              <IconButton
                icon={Paperclip}
                label="Adjuntar muestra"
                onPress={() =>
                  layers.open({
                    kind: "sheet",
                    title: "Adjuntar",
                    content: (
                      <>
                        <Text>Solo metadatos ficticios; máximo 50 MB.</Text>
                        <Button
                          onPress={() => {
                            setAttachment({
                              name: "Documento-demo.pdf",
                              bytes: 102400,
                            });
                            layers.close();
                          }}
                        >
                          Documento de demostración
                        </Button>
                      </>
                    ),
                  })
                }
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar interno"
              accessibilityState={{
                disabled: !draftReady || (!text.trim() && !attachment),
              }}
              disabled={!draftReady || (!text.trim() && !attachment)}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: c.accent,
                opacity: !text.trim() && !attachment ? 0.45 : 1,
              }}
              onPress={() =>
                void action.run(async () => {
                  followLatest.current = true;
                  await store.send(id, text, key.current, attachment, client);
                  draftValue.current = "";
                  await store.saveDraft(id, "");
                  setText("");
                  setAttachment(undefined);
                  setClient(undefined);
                  key.current = catalogKey();
                })
              }
            >
              <Send size={24} color={c.onAccent} />
            </Pressable>
          </View>
        </View>
      )}
    </>
  );
}
function Mentions({
  store,
  select,
}: {
  store: TeamChatStore;
  select: (name: string, client?: string) => void;
}) {
  const { team } = usePeople(),
    inbox = useInbox();
  return (
    <>
      <Section>Compañeros</Section>
      {team
        .filter((p) => p.id !== store.actorId)
        .map((p) => (
          <NavRow
            key={p.id}
            label={p.name}
            onPress={() => select("@" + p.name)}
          />
        ))}
      <Section>Chats de clientes</Section>
      {inbox.repository
        .list(inbox.actor)
        .filter((c) => !c.group && !c.archived && !c.campaign)
        .slice(0, 3)
        .map((c) => (
          <NavRow
            key={c.id}
            label={c.name}
            onPress={() => select("[Chat de cliente]", c.id)}
          />
        ))}
    </>
  );
}
export function InternalInfo() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    { store, state } = useInternal();
  return (
    <Screen>
      <Ready>{state.ready && <InfoBody store={store} id={id} />}</Ready>
    </Screen>
  );
}
function InfoBody({ store, id }: { store: TeamChatStore; id: string }) {
  const { personName } = usePeople(),
    layers = useLayers(),
    action = useAction();
  let room;
  try {
    room = store.get(id);
  } catch {
    return (
      <EmptyState
        title="Acceso no permitido"
        message="Conversación no disponible."
      />
    );
  }
  const remove = (member: string) =>
    layers.open({
      kind: "dialog",
      title:
        member === store.actorId
          ? "¿Salir del grupo?"
          : "¿Quitar participante?",
      content: <LeaveDialog store={store} id={id} member={member} />,
    });
  return (
    <>
      <InternalBar
        store={store}
        room={room}
        info
        onBack={() => router.back()}
      />
      <PageScroll>
        <Section>Participantes</Section>
        {(room.kind === "announcements"
          ? store.team.people().map((p) => p.id)
          : room.members
        ).map((member) => (
          <View
            key={member}
            style={{
              minHeight: 64,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <Avatar name={personName(member)} />
            <View style={{ flex: 1 }}>
              <Text weight="medium">
                {personName(member)}
                {member === store.actorId ? " (tú)" : ""}
              </Text>
              <Text kind="meta">
                {store.team.snapshot().doc.members.find((p) => p.id === member)
                  ?.role === "owner"
                  ? "Propietario"
                  : store.team
                        .snapshot()
                        .doc.members.find((p) => p.id === member)?.role ===
                      "coordinator"
                    ? "Coordinador"
                    : "Asesor"}
              </Text>
            </View>
            {room.kind === "group" &&
              room.creator === store.actorId &&
              member !== store.actorId && (
                <Button variant="ghost" onPress={() => remove(member)}>
                  Quitar participante
                </Button>
              )}
          </View>
        ))}
        {room.kind === "group" && (
          <Button variant="danger" onPress={() => remove(store.actorId)}>
            Salir del grupo
          </Button>
        )}
      </PageScroll>
    </>
  );
}

function LeaveDialog({
  store,
  id,
  member,
}: {
  store: TeamChatStore;
  id: string;
  member: string;
}) {
  const action = useAction(),
    layers = useLayers(),
    key = useRef(catalogKey());
  return (
    <>
      <Text>Se conservará el historial local.</Text>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button variant="secondary" onPress={layers.close}>
        Cancelar
      </Button>
      <Button
        variant="danger"
        onPress={() =>
          void action.run(async () => {
            await store.leave(id, member, key.current);
            layers.close();
            if (member === store.actorId)
              router.replace("/(tabs)/inbox?area=team");
          })
        }
      >
        Confirmar
      </Button>
    </>
  );
}

function SupervisionRooms() {
  const { store } = useInternal(),
    action = useAction(),
    layers = useLayers();
  return (
    <>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      {store.supervisionRooms().map((r) => (
        <NavRow
          key={r.id}
          label={store.title(r)}
          onPress={() =>
            void action.run(async () => {
              await store.openSupervised(r.id, catalogKey());
              layers.close();
              router.push(`/internal-chat/${r.id}?supervise=1`);
            })
          }
        />
      ))}
      {!store.supervisionRooms().length && (
        <EmptyState
          title="Sin conversaciones ajenas"
          message="Solo se muestran conversaciones de esta organización ficticia."
        />
      )}
    </>
  );
}
export function SupervisionLab() {
  const { store, state } = useInternal(),
    action = useAction();
  return (
    <Screen>
      <StudioBar
        title="Laboratorio de supervisión"
        onBack={() => router.back()}
      />
      <PageScroll>
        <Ready>
          {store.team.actor(store.actorId).role !== "owner" ? (
            <EmptyState
              title="Acceso no permitido"
              message="Solo propietario configura la muestra."
            />
          ) : (
            <>
              <Banner>
                Permisos locales explícitos. No afecta conversaciones reales.
              </Banner>
              {store.team
                .people()
                .filter((m) => m.role !== "advisor")
                .map((m) => (
                  <Button
                    key={m.id}
                    variant="secondary"
                    onPress={() =>
                      void action.run(() =>
                        store.setSupervisors(
                          (state.doc.supervisors ?? []).includes(m.id)
                            ? (state.doc.supervisors ?? []).filter(
                                (id) => id !== m.id,
                              )
                            : [...(state.doc.supervisors ?? []), m.id],
                          catalogKey(),
                        ),
                      )
                    }
                  >{`${(state.doc.supervisors ?? []).includes(m.id) ? "Revocar" : "Permitir"} supervisión: ${m.name}`}</Button>
                ))}
              <Text>Accesos auditados: {state.doc.audit?.length ?? 0}</Text>
            </>
          )}
          {!!action.error && <Banner type="danger">{action.error}</Banner>}
        </Ready>
      </PageScroll>
    </Screen>
  );
}

export function InternalSettings() {
  const { store, state } = useInternal(),
    action = useAction();
  return (
    <Screen>
      <StudioBar title="Chat de equipo" onBack={() => router.back()} />
      <Ready>
        <PageScroll>
          {store.team.actor(store.actorId).role !== "owner" ? (
            <EmptyState
              title="Acceso no permitido"
              message="Solo propietario configura grupos, Avisos y supervisión."
            />
          ) : (
            <>
              {!!action.error && <Banner type="danger">{action.error}</Banner>}
              <Switch
                label="Supervisión de conversaciones"
                value={!!state.doc.supervisors?.length}
                onChange={(v) =>
                  void action.run(() =>
                    store.setSupervisors(
                      v ? [store.actorId] : [],
                      catalogKey(),
                    ),
                  )
                }
              />
              <Text kind="meta">
                Habilitar te concede supervisión explícita de solo lectura. Cada
                acceso queda registrado. Desactivar retira todos los permisos de
                supervisión de esta organización ficticia.
              </Text>
              <Switch
                label="El Coordinador puede crear grupos"
                value={state.doc.policy?.coordinatorGroups === true}
                onChange={(v) =>
                  void action.run(() =>
                    store.setPolicy("coordinatorGroups", v, catalogKey()),
                  )
                }
              />
              <Switch
                label="Los asesores pueden publicar en Avisos"
                value={state.doc.policy?.advisorAnnouncements === true}
                onChange={(v) =>
                  void action.run(() =>
                    store.setPolicy("advisorAnnouncements", v, catalogKey()),
                  )
                }
              />
            </>
          )}
        </PageScroll>
      </Ready>
    </Screen>
  );
}
