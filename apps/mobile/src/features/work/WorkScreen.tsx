import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";
import { FlatList, Pressable, ScrollView, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Check, Clock3, MessageCircle, Plus } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  AppBar,
  FilterChips,
  SegmentedControl,
} from "../../components/ModuleUi";
import {
  Banner,
  EmptyState,
  ErrorState,
  Section,
  Skeleton,
  Text,
} from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { useSession } from "../../state/SessionProvider";
import { canAccess } from "../../domain/access";
import { useContactDirectory } from "../contact/context";
import type { ContactDirectory } from "../contact/core";
import { personName } from "../contact/model";
import { useInbox, useInboxState } from "../inbox/store";
import type { WorkTask, WorkNote, WorkRepository } from "./core";
import { TaskEditor, NoteEditor, noteColors } from "./editors";
const views = new WeakMap<
  WorkRepository,
  { tab: string; all: boolean; text: string; offset: number }
>();
export function WorkScreen() {
  const { session, disabled } = useSession();
  return (
    <Screen keyboard>
      {!session || !canAccess(session.role, "more", disabled) ? (
        <EmptyState
          title="Acceso no permitido"
          message="Tu perfil no tiene acceso a este módulo."
        />
      ) : (
        <WorkView />
      )}
    </Screen>
  );
}
function WorkView() {
  const dir = useContactDirectory(),
    repo = dir.workRepo,
    saved = views.get(repo),
    adding = useRef(false),
    list = useRef<FlatList<WorkTask>>(null),
    offset = useRef(saved?.offset ?? 0),
    s = useSyncExternalStore(repo.subscribe, repo.snapshot, repo.snapshot),
    inbox = useInboxState(),
    inboxStore = useInbox(),
    { tab: initial } = useLocalSearchParams<{ tab?: string }>(),
    [tab, setTab] = useState(
      initial === "notes" ? "notes" : (saved?.tab ?? "tasks"),
    ),
    [all, setAll] = useState(saved?.all ?? false),
    [text, setText] = useState(saved?.text ?? ""),
    [error, setError] = useState(""),
    { open } = useLayers(),
    { colors: c, dark } = useTheme();
  useEffect(() => {
    void repo.hydrate().then(() => repo.fixtures());
  }, [repo]);
  useEffect(() => {
    views.set(repo, { tab, all, text, offset: offset.current });
  }, [repo, tab, all, text]);
  useLayoutEffect(() => {
    if (s.ready && tab === "tasks")
      list.current?.scrollToOffset({ offset: offset.current, animated: false });
  }, [s.ready, tab]);
  const openTask = useCallback(
    (t: WorkTask) =>
      open({
        kind: "sheet",
        title: "Detalle de la tarea",
        content: <TaskEditor directory={dir} initial={t} />,
      }),
    [open, dir],
  );
  const openNote = (n?: WorkNote) =>
    open({
      kind: "sheet",
      title: "Nota",
      content: <NoteEditor directory={dir} initial={n} />,
    });
  const add = async () => {
    const value = text;
    if (!value.trim() || adding.current) return;
    adding.current = true;
    try {
      await repo.saveTask({
        title: value,
        notes: "",
        due: Date.now() + 86400000,
        assignee: repo.actor.id,
        contactId: null,
      });
      setText((t) => (t === value ? "" : t));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      adding.current = false;
    }
  };
  const tasks = useMemo(() => {
      const rows = repo.tasks(all);
      return [...rows.filter((t) => !t.done), ...rows.filter((t) => t.done)];
    }, [repo, s.doc, s.visibility, all]),
    doneIndex = tasks.findIndex((t) => t.done),
    notes = repo.notes(),
    status = inbox.status;
  return (
    <>
      <AppBar
        title="Tareas y notas"
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/more")
        }
      />
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        <SegmentedControl
          options={[
            { key: "tasks", label: "Tareas" },
            { key: "notes", label: "Notas" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      {status === "offline" && (
        <Banner type="warning">
          Sin conexión · datos locales de demostración.
        </Banner>
      )}
      {!s.ready ? (
        s.error ? (
          <>
            <Banner type="danger">{s.error}</Banner>
            <ErrorState
              onRetry={() => void repo.hydrate().then(() => repo.fixtures())}
            />
          </>
        ) : (
          <Skeleton rows={4} />
        )
      ) : status === "loading" ? (
        <Skeleton rows={4} />
      ) : status === "error" ? (
        <ErrorState
          onRetry={() => {
            inboxStore.reload();
            inboxStore.patch({ status: "normal" });
          }}
        />
      ) : tab === "tasks" ? (
        <>
          {repo.actor.role !== "advisor" && (
            <View style={{ paddingHorizontal: 16 }}>
              <FilterChips
                options={["Mis tareas", "Todo el equipo"]}
                value={all ? "Todo el equipo" : "Mis tareas"}
                onChange={(label) => setAll(label === "Todo el equipo")}
              />
            </View>
          )}
          <FlatList
            ref={list}
            onScroll={(e) => {
              offset.current = e.nativeEvent.contentOffset.y;
              const state = views.get(repo);
              if (state) state.offset = offset.current;
            }}
            scrollEventThrottle={100}
            testID="work-task-list"
            data={status === "empty" ? [] : tasks}
            keyExtractor={(t) => t.id}
            initialNumToRender={12}
            windowSize={7}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 32 }}
            ListHeaderComponent={
              <View style={{ marginHorizontal: 16, marginVertical: 8 }}>
                <TextInput
                  accessibilityLabel="Agregar tarea"
                  placeholder="Agregar tarea y presionar Enter…"
                  placeholderTextColor={c.text3}
                  value={text}
                  onChangeText={setText}
                  maxLength={300}
                  returnKeyType="done"
                  onSubmitEditing={() => void add()}
                  style={{
                    height: 48,
                    borderWidth: 1,
                    borderColor: c.borderStrong,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    color: c.text,
                    fontFamily: "Inter_400Regular",
                    fontSize: 16,
                  }}
                />
                {!!error && <Banner type="danger">{error}</Banner>}
              </View>
            }
            renderItem={({ item: t, index }) => (
              <>
                {index === doneIndex && (
                  <View style={{ paddingHorizontal: 16 }}>
                    <Section>Hechas</Section>
                  </View>
                )}
                <TaskRow
                  task={t}
                  directory={dir}
                  contact={
                    t.contactId
                      ? dir.conversations.get(dir.actor, t.contactId).name
                      : ""
                  }
                  assignee={all ? personName(t.assignee) : ""}
                  onOpen={openTask}
                  onError={setError}
                />
              </>
            )}
            ListEmptyComponent={
              <EmptyState
                title={status === "empty" ? "Sin tareas" : "Todo al día"}
                message="Crea la primera con el campo de arriba."
              />
            }
          />
        </>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }}>
          {status === "empty" || !notes.length ? (
            <EmptyState
              title="Aún no tienes notas"
              message="Anota ideas, precios o recordatorios."
            />
          ) : (
            [true, false].map((pin) => (
              <View key={String(pin)}>
                <Section>{pin ? "Fijadas" : "Otras"}</Section>
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}
                >
                  {notes
                    .filter((n) => n.pin === pin)
                    .map((n) => {
                      const [bg, color] =
                        noteColors[dark ? "dark" : "light"][n.color];
                      return (
                        <Pressable
                          key={n.id}
                          accessibilityRole="button"
                          accessibilityLabel={n.title || n.body.slice(0, 80)}
                          onPress={() => openNote(n)}
                          style={{
                            width: "48%",
                            minHeight: 100,
                            padding: 14,
                            borderRadius: 16,
                            backgroundColor: bg,
                            gap: 6,
                          }}
                        >
                          {!!n.title && (
                            <Text weight="semibold" style={{ color }}>
                              {n.title}
                            </Text>
                          )}
                          <Text
                            kind="secondary"
                            style={{ color }}
                            numberOfLines={8}
                          >
                            {n.body}
                          </Text>
                          {n.contactId && (
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              <MessageCircle size={13} color={color} />
                              <Text kind="meta" style={{ color, flex: 1 }}>
                                {
                                  dir.conversations.get(dir.actor, n.contactId)
                                    .name
                                }
                              </Text>
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
      {s.ready && tab === "notes" && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Nueva nota"
          onPress={() => openNote()}
          style={{
            position: "absolute",
            right: 18,
            bottom: 24,
            width: 56,
            height: 56,
            borderRadius: 18,
            backgroundColor: c.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Plus size={24} color={c.onAccent} />
        </Pressable>
      )}
    </>
  );
}
const TaskRow = memo(function TaskRow({
  task: t,
  directory: dir,
  contact,
  assignee,
  onOpen,
  onError,
}: {
  task: WorkTask;
  directory: ContactDirectory;
  contact: string;
  assignee: string;
  onOpen: (t: WorkTask) => void;
  onError: (message: string) => void;
}) {
  const { colors: c } = useTheme(),
    late = !t.done && t.due < Date.now();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        minHeight: 72,
        borderBottomWidth: 1,
        borderColor: c.border,
        gap: 4,
      }}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`Marcar tarea: ${t.title}`}
        accessibilityState={{ checked: t.done }}
        aria-checked={t.done}
        onPress={() => {
          void dir.workRepo.toggleTask(t.id).catch((e) => onError(e.message));
        }}
        style={{
          width: 48,
          height: 48,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: t.done ? c.accent : c.borderStrong,
            backgroundColor: t.done ? c.accent : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {t.done && <Check size={15} color={c.onAccent} />}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Detalle: ${t.title}`}
        onPress={() => onOpen(t)}
        style={{
          flex: 1,
          minHeight: 60,
          justifyContent: "center",
          gap: 4,
          paddingVertical: 10,
        }}
      >
        <Text
          style={{
            textDecorationLine: t.done ? "line-through" : "none",
            color: t.done ? c.text3 : c.text,
          }}
        >
          {t.title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Clock3 size={12} color={late ? c.danger : c.text3} />
          <Text
            kind="meta"
            style={{ color: late ? c.danger : c.text3, flex: 1 }}
          >
            {new Date(t.due).toLocaleDateString("es-MX", {
              day: "numeric",
              month: "short",
            })}
            {contact ? ` · ${contact}` : ""}
            {assignee ? ` · ${assignee}` : ""}
          </Text>
        </View>
      </Pressable>
    </View>
  );
});
