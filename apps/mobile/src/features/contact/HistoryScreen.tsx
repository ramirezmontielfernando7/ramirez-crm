import React, { memo, useCallback, useMemo, useRef } from "react";
import { Pressable, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import {
  Check,
  Clock3,
  GitBranch,
  MoreVertical,
  NotebookPen,
  PlugZap,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Tag,
  UserCheck,
} from "lucide-react-native";
import {
  AppBar,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  FilterChips,
  IconButton,
  Skeleton,
  Text,
} from "../../components/ui";
import { Screen } from "../../components/Screen";
import { useTheme } from "../../theme/ThemeProvider";
import { useLayers } from "../../components/Layers";
import { useConversation } from "../inbox/store";
import { useAction } from "../chat/Sheets";
import { actionKey, type ContactStore } from "./core";
import { useContactDirectory, useContactState } from "./context";
import { useContactActions } from "./actions";
import type { Event, EventKind } from "./model";
import { DeniedContact } from "./DetailsScreen";
const keyFor = (e: Event) => e.id;
const filters: Record<string, EventKind | undefined> = {
  Todo: undefined,
  Notas: "Nota",
  Etapas: "Etapa",
  Asignación: "Asignación",
  IA: "IA",
  Etiquetas: "Etiquetas",
};
const icons = {
  Nota: StickyNote,
  Etapa: GitBranch,
  Asignación: UserCheck,
  IA: Sparkles,
  Etiquetas: Tag,
  Consentimiento: ShieldCheck,
  Conexión: PlugZap,
  Tarea: NotebookPen,
  Venta: GitBranch,
};
const EventRow = memo(function EventRow({ event }: { event: Event }) {
  const { colors: c } = useTheme();
  const Icon = icons[event.kind];
  return (
    <View
      style={{
        paddingLeft: 24,
        paddingRight: 8,
        paddingBottom: 18,
        paddingTop: 6,
        minHeight: 64,
      }}
    >
      <View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 6,
          width: 2,
          backgroundColor: c.border,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 13,
          left: 1,
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: c.accent,
          borderWidth: 2,
          borderColor: c.surface,
        }}
      />
      <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
        <Icon size={17} color={c.text2} />
        <Text weight="semibold" style={{ flex: 1 }} selectable>
          {event.text}
        </Text>
      </View>
      <Text kind="secondary" style={{ color: c.text3, paddingTop: 4 }}>
        {new Date(event.at).toLocaleTimeString("es-MX", {
          hour: "numeric",
          minute: "2-digit",
        })}{" "}
        · {event.kind}
      </Text>
    </View>
  );
});
const renderEvent = ({ item }: { item: Event }) => <EventRow event={item} />;
export function HistoryScreen({ store }: { store: ContactStore }) {
  const s = useContactState(store),
    cvo = useConversation(store.id)!,
    { colors: c, dark } = useTheme(),
    actions = useContactActions(store),
    action = useAction();
  const list = useRef<FlashListRef<Event>>(null),
    focused = useRef(false),
    ready = useRef(false),
    key = useRef(actionKey());
  const rows = useMemo(
    () =>
      s.view === "empty"
        ? []
        : s.data.events.filter(
            (e) => !filters[s.filter] || e.kind === filters[s.filter],
          ),
    [s.data.events, s.filter, s.view],
  );
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      const f = requestAnimationFrame(() =>
        list.current?.scrollToOffset({
          offset: store.timelineOffset,
          animated: false,
        }),
      );
      return () => {
        focused.current = false;
        cancelAnimationFrame(f);
      };
    }, [store]),
  );
  const save = () =>
    void action.run(async () => {
      await store.note(s.noteDraft, key.current);
      key.current = actionKey();
      store.timelineOffset = 0;
      list.current?.scrollToOffset({ offset: 0, animated: false });
    });
  const disabled =
    !s.ready ||
    !s.noteDraft.trim() ||
    action.busy ||
    (s.view !== "normal" && s.view !== "empty");
  return (
    <Screen keyboard>
      <AppBar
        title="Historial"
        onBack={() =>
          router.canGoBack()
            ? router.back()
            : router.replace(`/contact/${store.id}`)
        }
        actions={
          <IconButton
            icon={MoreVertical}
            label="Opciones del historial"
            onPress={actions.demo}
          />
        }
      />
      <Text
        kind="secondary"
        style={{ color: c.text3, paddingHorizontal: 56, paddingBottom: 8 }}
      >
        {cvo.name}
      </Text>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <FilterChips
          options={Object.keys(filters)}
          value={s.filter}
          onChange={(v) => {
            store.setFilter(v);
            list.current?.scrollToOffset({ offset: 0, animated: false });
          }}
        />
      </View>
      {s.view === "offline" && (
        <View style={{ paddingHorizontal: 16 }}>
          <Banner type="warning">
            Sin conexión · La nota se conserva como borrador
          </Banner>
          <Button variant="ghost" onPress={() => store.view("normal")}>
            Reconectar historial
          </Button>
        </View>
      )}
      {action.error && (
        <View style={{ paddingHorizontal: 16 }}>
          <Banner type="danger">{action.error}</Banner>
        </View>
      )}
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        {!s.ready || s.view === "loading" ? (
          <View>
            <Skeleton rows={4} />
            {s.error ? (
              <>
                <Banner type="danger">{s.error}</Banner>
                <Button onPress={() => void store.hydrate()}>
                  Reintentar detalles
                </Button>
              </>
            ) : (
              s.ready && (
                <Button onPress={() => store.view("normal")}>
                  Finalizar carga simulada
                </Button>
              )
            )}
          </View>
        ) : s.view === "error" ? (
          <ErrorState onRetry={() => store.view("normal")} />
        ) : (
          <FlashList
            ref={list}
            testID="contact-history"
            accessibilityLabel={`Historial interno: ${rows.length} eventos`}
            data={rows}
            renderItem={renderEvent}
            keyExtractor={keyFor}
            getItemType={(e) => e.kind}
            drawDistance={300}
            onLoad={() => {
              ready.current = true;
              list.current?.scrollToOffset({
                offset: store.timelineOffset,
                animated: false,
              });
            }}
            onScroll={(e) => {
              if (focused.current && ready.current)
                store.timelineOffset = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={100}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingTop: 0, paddingBottom: 20 }}
            ListEmptyComponent={
              <EmptyState
                title="Aún no hay actividad"
                message="Las notas y los cambios del chat aparecerán aquí."
              />
            }
          />
        )}
      </View>
      <View
        style={{
          padding: 12,
          gap: 4,
          borderTopWidth: 1,
          borderColor: c.border,
        }}
      >
        <Text kind="meta" style={{ color: c.text3 }}>
          Solo tu equipo · No se envía al cliente
        </Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
          <TextInput
            accessibilityLabel="Nueva nota interna"
            placeholder="Escribe una nota interna…"
            placeholderTextColor={c.text3}
            value={s.noteDraft}
            onChangeText={store.setNoteDraft}
            editable={s.ready}
            multiline
            maxLength={4000}
            submitBehavior="newline"
            style={{
              flex: 1,
              fontFamily: "Inter_400Regular",
              fontSize: 15,
              color: c.text,
              minHeight: 48,
              maxHeight: 120,
              borderRadius: 24,
              paddingHorizontal: 16,
              paddingVertical: 12,
              backgroundColor: dark ? "#40300f" : "#fef6e6",
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Guardar nota interna"
            accessibilityState={{ disabled, busy: action.busy }}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={save}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: c.accent,
              opacity: disabled ? 0.45 : 1,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Check size={26} color={c.onAccent} />
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
export default function HistoryPage() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    directory = useContactDirectory();
  const conversation = useConversation(id ?? "");
  if (!conversation) return <DeniedContact />;
  let store: ContactStore;
  try {
    store = directory.get(id);
  } catch {
    return <DeniedContact />;
  }
  return <HistoryScreen key={id} store={store} />;
}
