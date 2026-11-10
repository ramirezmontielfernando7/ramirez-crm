import React, {
  memo,
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScrollView, Pressable, View, useWindowDimensions } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import {
  Archive,
  ArrowLeft,
  Check,
  CheckCheck,
  MessageSquarePlus,
  MoreVertical,
  Search,
  SquareCheckBig,
  UserPlus,
  X,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  AppBar,
  Avatar,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  FilterChips,
  IconButton,
  NavRow,
  SearchBox,
  Section,
  SegmentedControl,
  Skeleton,
  StageCapsule,
  TagCapsule,
  Text,
  UnreadBadge,
} from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import {
  defaultFilters,
  queryConversations,
  stages,
  tags,
  type Conversation,
  type Filters,
} from "./model";
import { useInbox, useInboxState, type DataState } from "./store";
const go = (id: string) => router.push(`/conversation/${id}`);
const ConversationRow = memo(function ConversationRow({
  item,
  selected,
  selecting,
  onOpen,
  onToggle,
}: {
  item: Conversation;
  selected: boolean;
  selecting: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const { colors: c } = useTheme();
  const { fontScale } = useWindowDimensions();
  return (
    <Pressable
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={`${item.name}, ${item.preview}, ${item.unread} sin leer`}
      accessibilityState={selecting ? { checked: selected } : undefined}
      aria-checked={selecting ? selected : undefined}
      onPress={() => (selecting ? onToggle(item.id) : onOpen(item.id))}
      onLongPress={() => onToggle(item.id)}
      delayLongPress={350}
      style={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: selected ? c.tint : c.surface,
        flexDirection: "row",
        gap: 12,
        minHeight: 94,
        alignItems: "center",
      }}
    >
      {selecting && (
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            borderWidth: 2,
            borderColor: c.accent,
            backgroundColor: selected ? c.accent : c.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {selected && <Check size={16} color={c.onAccent} />}
        </View>
      )}
      <View>
        <Avatar name={item.name} />
        <View
          accessibilityLabel={`IA ${item.ai === "on" ? "activa" : item.ai === "pause" ? "en pausa" : "apagada"}`}
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 14,
            height: 14,
            borderRadius: 7,
            borderWidth: 3,
            borderColor: c.surface,
            backgroundColor:
              item.ai === "on"
                ? c.success
                : item.ai === "pause"
                  ? "#f2a71b"
                  : c.text3,
          }}
        />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Text
            kind="name"
            weight="medium"
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {item.name}
          </Text>
          <Text
            kind="meta"
            style={{ color: item.unread ? c.accentInk : c.text3 }}
          >
            {item.time}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {item.id === "demo-conv-3" && <CheckCheck size={16} color={c.info} />}
          <Text
            kind="secondary"
            numberOfLines={1}
            style={{ flex: 1, color: c.text3 }}
          >
            {item.campaign ? "Plantilla enviada · sin respuesta" : item.preview}
          </Text>
          <UnreadBadge count={item.unread} />
        </View>
        {fontScale <= 1.3 && (
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {item.campaign ? (
              <TagCapsule>{item.campaign}</TagCapsule>
            ) : (
              <>
                <StageCapsule>
                  {item.group ? "Grupo de WhatsApp" : item.stage}
                </StageCapsule>
                {item.tags.slice(0, 2).map((tag) => (
                  <TagCapsule key={tag}>{tag}</TagCapsule>
                ))}
              </>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
});
function WrapChoices({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((label) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          aria-pressed={label === value}
          accessibilityState={{ selected: label === value }}
          onPress={() => onChange(label)}
          style={{
            minHeight: 48,
            paddingHorizontal: 14,
            justifyContent: "center",
            borderRadius: 999,
            borderWidth: 1,
            borderColor: c.borderStrong,
            backgroundColor: label === value ? c.wash : c.surface,
          }}
        >
          <Text
            kind="secondary"
            style={{ color: label === value ? c.accentInk : c.text2 }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
function FiltersSheet() {
  const store = useInbox();
  const s = useInboxState();
  const { close } = useLayers();
  const [draft, setDraft] = useState<Filters>(s.filters);
  const set = (key: keyof Filters) => (v: string) =>
    setDraft((d) => ({ ...d, [key]: v }));
  const count = useMemo(
    () => queryConversations(s.data, store.actor, draft).length,
    [s.data, store, draft],
  );
  return (
    <>
      <Section>Etapa del embudo</Section>
      <WrapChoices
        options={["Toda etapa", ...stages]}
        value={draft.stage}
        onChange={set("stage")}
      />
      <Section>Etiqueta</Section>
      <WrapChoices
        options={["Toda etiqueta", ...tags]}
        value={draft.tag}
        onChange={set("tag")}
      />
      <Section>Quién atiende</Section>
      <WrapChoices
        options={
          store.actor.role === "advisor"
            ? ["Míos"]
            : ["Todo el equipo", "Míos", "Sin asignar"]
        }
        value={store.actor.role === "advisor" ? "Míos" : draft.who}
        onChange={set("who")}
      />
      <Button
        variant="secondary"
        onPress={() =>
          setDraft({
            ...defaultFilters,
            chip: s.filters.chip,
            query: s.filters.query,
          })
        }
      >
        Limpiar
      </Button>
      <Button
        onPress={() => {
          store.filter(draft);
          close();
        }}
      >{`Ver ${count} chats`}</Button>
    </>
  );
}
function NewChat() {
  const store = useInbox();
  const s = useInboxState();
  const { close } = useLayers();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const list = useMemo(
    () =>
      queryConversations(s.data, store.actor, {
        ...defaultFilters,
        query,
      }).slice(0, 6),
    [s.data, store, query],
  );
  return creating ? (
    <>
      <Field label="Nombre ficticio" value={name} onChangeText={setName} />
      <Field
        label="Teléfono ficticio con lada"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      {!!error && <Banner type="danger">{error}</Banner>}
      <Button
        onPress={() => {
          try {
            const c = store.create(name, phone);
            close();
            go(c.id);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Crear contacto de prueba
      </Button>
      <Button variant="ghost" onPress={() => setCreating(false)}>
        Volver a contactos
      </Button>
    </>
  ) : (
    <>
      <SearchBox
        accessibilityLabel="Buscar contacto"
        placeholder="Nombre o teléfono"
        value={query}
        onChangeText={setQuery}
      />
      {list.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`Abrir contacto ${item.name}`}
          onPress={() => {
            close();
            go(item.id);
          }}
          style={{
            minHeight: 72,
            flexDirection: "row",
            gap: 12,
            alignItems: "center",
          }}
        >
          <Avatar name={item.name} />
          <View style={{ flex: 1 }}>
            <Text weight="medium">{item.name}</Text>
            <Text kind="secondary">{item.phone}</Text>
          </View>
          {item.closed && <Text kind="capsule">Con plantilla</Text>}
        </Pressable>
      ))}
      {!list.length && (
        <EmptyState
          title="Sin coincidencias"
          message="Escribe un número completo con lada para crear el contacto ficticio."
        />
      )}
      <NavRow
        icon={UserPlus}
        label="Nuevo contacto"
        onPress={() => {
          setPhone(query);
          setCreating(true);
        }}
      />
    </>
  );
}
function AssignSheet() {
  const store = useInbox();
  const { close, toast } = useLayers();
  const [error, setError] = useState("");
  return (
    <>
      {!!error && <Banner type="danger">{error}</Banner>}
      {[
        ["demo-owner", "Fer Ramírez"],
        ["demo-coordinator", "Ana López"],
        ["demo-advisor", "Luis Ortega"],
      ].map(([id, name]) => (
        <NavRow
          key={id}
          label={name!}
          onPress={() => {
            try {
              store.assign(id!);
              close();
              toast("Asignación simulada actualizada");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      ))}
    </>
  );
}
function StateControls() {
  const store = useInbox();
  const s = useInboxState();
  const { close, toast } = useLayers();
  return (
    <>
      <Text kind="secondary">
        Solo pruebas locales. No se conecta a WhatsApp.
      </Text>
      {(["normal", "loading", "empty", "error", "offline"] as DataState[]).map(
        (v, i) => (
          <NavRow
            key={v}
            label={["Normal", "Cargando", "Vacía", "Error", "Sin conexión"][i]!}
            onPress={() => {
              store.patch({ status: v });
              close();
            }}
          />
        ),
      )}
      <Button
        variant="tonal"
        onPress={() => {
          const c = s.data.find((c) => c.campaign);
          if (c) {
            store.incoming(c.id);
            toast(
              s.status === "offline"
                ? "Respuesta ficticia en espera de reconexión"
                : "Respuesta ficticia: pasó de Campañas a Clientes",
            );
          } else toast("No hay campañas pendientes para este perfil");
          close();
        }}
      >
        Simular respuesta de campaña
      </Button>
    </>
  );
}
export default function InboxScreen() {
  const store = useInbox();
  const s = useInboxState();
  const { colors: c } = useTheme();
  const { open, close, toast } = useLayers();
  const list = useRef<FlashListRef<Conversation>>(null);
  const ready = useRef(false);
  const focused = useRef(false);
  const [resume, setResume] = useState({ epoch: 0, index: 0, within: 0 });
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      const saved = store.anchor;
      const snapshot = store.snapshot();
      const index = saved
        ? queryConversations(
            snapshot.data,
            store.actor,
            snapshot.filters,
          ).findIndex((c) => c.id === saved.id)
        : -1;
      const anchor = saved && index >= 0 ? { ...saved, index } : null;
      if (anchor) {
        ready.current = false;
        setResume((v) => ({ ...anchor, epoch: v.epoch + 1 }));
      }
      return () => {
        focused.current = false;
      };
    }, [store]),
  );
  React.useEffect(() => {
    store.scrollToTop = () => {
      store.anchor = null;
      store.offset = 0;
      list.current?.scrollToOffset({ offset: 0, animated: false });
    };
    return () => {
      store.scrollToTop = () => {};
    };
  }, [store]);
  const [refreshing, setRefreshing] = useState(false);
  const query = useDeferredValue(s.filters.query);
  const filters = useMemo(() => ({ ...s.filters, query }), [s.filters, query]);
  const data = useMemo(
    () =>
      s.status === "empty"
        ? []
        : queryConversations(s.data, store.actor, filters),
    [s.data, filters, store, s.status],
  );
  const onOpen = useCallback(
    (id: string) => {
      const ref = list.current;
      if (ref) {
        const index = ref.getFirstVisibleIndex();
        const layout = ref.getLayout(index);
        store.offset = ref.getAbsoluteLastScrollOffset();
        if (layout)
          store.anchor = {
            id: ref.props.data?.[index]?.id ?? id,
            index,
            within: store.offset - layout.y - ref.getFirstItemOffset(),
          };
      }
      go(id);
    },
    [store],
  );
  const onToggle = useCallback((id: string) => store.toggle(id), [store]);
  const select = () => store.patch({ selecting: true, searching: false });
  const newChat = () =>
    open({ kind: "sheet", title: "Nuevo chat", content: <NewChat /> });
  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <ConversationRow
        item={item}
        selecting={s.selecting}
        selected={s.selected.has(item.id)}
        onOpen={onOpen}
        onToggle={onToggle}
      />
    ),
    [s.selecting, s.selected, onOpen, onToggle],
  );
  const menu = () =>
    open({
      kind: "menu",
      title: "Bandeja",
      content: (
        <>
          <NavRow
            label="Filtros…"
            onPress={() =>
              open({
                kind: "sheet",
                title: "Filtros",
                content: <FiltersSheet />,
              })
            }
          />
          <NavRow
            label="Ver archivados"
            onPress={() => {
              store.filter({ chip: "Archivados" });
              close();
            }}
          />
          <NavRow
            label="Seleccionar varios"
            onPress={() => {
              select();
              close();
            }}
          />
          <NavRow label="Nuevo chat" onPress={newChat} />
          <NavRow
            label="Pruebas de estado"
            onPress={() =>
              open({
                kind: "sheet",
                title: "Estados de la Bandeja",
                content: <StateControls />,
              })
            }
          />
        </>
      ),
    });
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if (s.status === "offline")
        throw new Error("Sin conexión. Se conservan los datos de prueba.");
      store.reload();
      store.patch({ status: "normal" });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const counts = useMemo(
    () => ({
      "No leídos": s.data.filter(
        (c) => !c.archived && !c.campaign && c.unread > 0,
      ).length,
      Campañas: s.data.filter((c) => !c.archived && c.campaign).length,
    }),
    [s.data],
  );
  const active =
    s.filters.stage !== "Toda etapa" ||
    s.filters.tag !== "Toda etiqueta" ||
    s.filters.who !== "Todo el equipo";
  return (
    <Screen keyboard>
      {s.selecting ? (
        <AppBar
          title={`${s.selected.size} seleccionado${s.selected.size === 1 ? "" : "s"}`}
          onBack={() => store.cancel()}
          actions={
            <>
              {store.actor.role !== "advisor" && (
                <IconButton
                  icon={UserPlus}
                  label="Asignar selección"
                  disabled={!s.selected.size}
                  onPress={() =>
                    open({
                      kind: "sheet",
                      title: "Asignar conversaciones",
                      content: <AssignSheet />,
                    })
                  }
                />
              )}
              <IconButton
                icon={Archive}
                label="Archivar selección"
                disabled={!s.selected.size}
                onPress={() => {
                  store.archive();
                  toast("Archivo simulado actualizado");
                }}
              />
            </>
          }
        />
      ) : s.searching ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingRight: 12,
          }}
        >
          <IconButton
            icon={ArrowLeft}
            label="Cerrar búsqueda"
            onPress={() => {
              store.patch({ searching: false });
              store.filter({ query: "" });
            }}
          />
          <View style={{ flex: 1 }}>
            <SearchBox
              accessibilityLabel="Buscar chats"
              placeholder="Buscar chats, contactos o etiquetas"
              autoFocus
              value={s.filters.query}
              onChangeText={(query) => store.filter({ query })}
            />
          </View>
          <IconButton
            icon={X}
            label="Borrar búsqueda"
            onPress={() => store.filter({ query: "" })}
          />
        </View>
      ) : (
        <AppBar
          title="Bandeja"
          module
          actions={
            <>
              <IconButton
                icon={Search}
                label="Buscar"
                onPress={() => store.patch({ searching: true })}
              />
              <IconButton
                icon={SquareCheckBig}
                label="Seleccionar varios"
                onPress={select}
              />
              <IconButton
                icon={MoreVertical}
                label="Más opciones de Bandeja"
                onPress={menu}
              />
            </>
          }
        />
      )}
      {!s.selecting && !s.searching && (
        <View style={{ paddingHorizontal: 16, gap: 8, paddingTop: 8 }}>
          <SegmentedControl
            options={[
              { key: "clients", label: "Clientes" },
              { key: "team", label: "Equipo" },
              { key: "number", label: "Mi número" },
            ]}
            value="clients"
            onChange={(key) =>
              open({
                kind: "dialog",
                title: key === "team" ? "Equipo" : "Mi número",
                content: (
                  <>
                    <Text>
                      Este módulo se implementará en T-M6. La Bandeja de
                      Clientes ya está disponible.
                    </Text>
                    <Button onPress={close}>Volver a Clientes</Button>
                  </>
                ),
              })
            }
          />
          <FilterChips
            options={["Todos", `No leídos`, `Míos`, "Campañas", "Grupos"]}
            value={s.filters.chip}
            counts={counts}
            onChange={(chip) => store.filter({ chip })}
          />
          {(active || s.filters.chip === "Archivados") && (
            <Button
              variant="tonal"
              onPress={() =>
                open({
                  kind: "sheet",
                  title: "Filtros",
                  content: <FiltersSheet />,
                })
              }
            >
              {s.filters.chip === "Archivados"
                ? "Archivados · Filtros"
                : "Filtros activos"}
            </Button>
          )}
        </View>
      )}
      {s.searching && !!query && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text kind="capsule">Resultados en Clientes</Text>
        </View>
      )}
      {s.status === "offline" && (
        <View style={{ paddingHorizontal: 16 }}>
          <Banner type="warning">
            Sin conexión · Mostrando datos guardados
          </Banner>
          <Button variant="ghost" onPress={() => store.reconnect()}>
            Reconectar simulación
          </Button>
        </View>
      )}
      {s.status === "loading" ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 130 }}
        >
          <Skeleton rows={6} />
          <Button
            variant="ghost"
            onPress={() => store.patch({ status: "normal" })}
          >
            Completar carga simulada
          </Button>
        </ScrollView>
      ) : s.status === "error" ? (
        <View style={{ padding: 16, flex: 1 }}>
          <ErrorState onRetry={() => store.patch({ status: "normal" })} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlashList
            ref={list}
            testID="conversation-list"
            accessibilityLabel={`Conversaciones: ${data.length} resultados`}
            data={data}
            key={`${JSON.stringify(filters)}:${resume.epoch}`}
            initialScrollIndex={store.anchor ? resume.index : undefined}
            initialScrollIndexParams={{ viewOffset: resume.within }}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            extraData={s.selected}
            drawDistance={400}
            onLoad={() => {
              ready.current = true;
            }}
            onScroll={(e) => {
              if (
                ready.current &&
                focused.current &&
                JSON.stringify(filters) ===
                  JSON.stringify(store.snapshot().filters)
              ) {
                store.offset = e.nativeEvent.contentOffset.y;
                const ref = list.current;
                if (ref) {
                  const index = ref.getFirstVisibleIndex();
                  const layout = ref.getLayout(index);
                  if (layout && data[index])
                    store.anchor = {
                      id: data[index]!.id,
                      index,
                      within:
                        store.offset - layout.y - ref.getFirstItemOffset(),
                    };
                }
              }
            }}
            scrollEventThrottle={100}
            onRefresh={() => void refresh()}
            refreshing={refreshing}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingBottom: 180,
              backgroundColor: c.surface,
            }}
            ListHeaderComponent={
              s.filters.chip === "Campañas" ? (
                <View style={{ padding: 16 }}>
                  <Text kind="secondary">
                    Plantillas enviadas sin respuesta. Cuando el contacto
                    escriba, pasa a Clientes.
                  </Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={{ padding: 20 }}>
                <EmptyState
                  title={
                    query
                      ? "Sin resultados"
                      : s.status === "empty"
                        ? "Aún no tienes chats"
                        : "No hay chats aquí"
                  }
                  message={
                    query
                      ? "Prueba con otro nombre, teléfono o etiqueta."
                      : "Cuando un cliente escriba, su conversación aparecerá aquí."
                  }
                  action={
                    <Button
                      variant="secondary"
                      onPress={() => {
                        store.filter({ ...defaultFilters });
                        store.patch({ status: "normal" });
                      }}
                    >
                      Quitar filtros
                    </Button>
                  }
                />
              </View>
            }
          />
        </View>
      )}
      {s.selecting && (
        <View
          style={{
            position: "absolute",
            bottom: 92,
            left: 16,
            right: 16,
            flexDirection: "row",
            gap: 12,
            padding: 8,
            backgroundColor: c.surface,
            borderTopWidth: 1,
            borderColor: c.border,
          }}
        >
          {store.actor.role !== "advisor" && (
            <View style={{ flex: 1 }}>
              <Button
                variant="tonal"
                disabled={!s.selected.size}
                onPress={() =>
                  open({
                    kind: "sheet",
                    title: "Asignar conversaciones",
                    content: <AssignSheet />,
                  })
                }
              >
                Asignar
              </Button>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Button
              variant="secondary"
              disabled={!s.selected.size}
              onPress={() => {
                store.archive();
                toast("Archivo simulado actualizado");
              }}
            >
              Archivar
            </Button>
          </View>
        </View>
      )}
      {!s.selecting && (
        <View
          style={{
            position: "absolute",
            bottom: 100,
            right: 16,
            backgroundColor: c.accent,
            borderRadius: 20,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Nuevo chat"
            onPress={newChat}
            style={{
              width: 56,
              height: 56,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MessageSquarePlus size={26} strokeWidth={1.8} color={c.onAccent} />
          </Pressable>
        </View>
      )}
    </Screen>
  );
}
