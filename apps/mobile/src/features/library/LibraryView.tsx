import { knowledgeDefaults } from "../knowledge/model";
import { router } from "expo-router";
import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import {
  FileText,
  FileUp,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  MoreVertical,
  MessageCircle,
  Sparkles,
  Plus,
  Tag,
  Trash2,
} from "lucide-react-native";
import { AppBar, FilterChips, IconButton } from "../../components/ModuleUi";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  NavRow,
  PickerRow,
  SearchBox,
  Section,
  Skeleton,
  Switch,
  Text,
} from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { refinementB } from "../../theme/refinement-b";
import { SectionTabs, type CrmSection } from "../crm/SectionTabs";
import { LibraryStore, librarySamples, type LibraryDraft } from "./core";

export function LibraryView({
  store,
  onSection,
}: {
  store: LibraryStore;
  onSection: (s: CrmSection) => void;
}) {
  const s = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    { colors: c } = useTheme(),
    layers = useLayers();
  useEffect(() => {
    void store.hydrate();
  }, [store]);

  const menu = () =>
    layers.open({
      kind: "menu",
      title: "Biblioteca",
      content: <LibraryMenu store={store} />,
    });
  const rows = store.list();
  return (
    <>
      <AppBar
        title="CRM"
        module
        actions={
          <>
            <IconButton
              icon={LayoutGrid}
              label="Cambiar vista"
              onPress={() => store.configure({ grid: !s.grid })}
            />
            <IconButton
              icon={MoreVertical}
              label="Más opciones de Biblioteca"
              onPress={menu}
            />
          </>
        }
      />
      <SectionTabs value="library" onChange={onSection} />
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 4 }}>
        <SearchBox
          accessibilityLabel="Buscar por título o contenido"
          placeholder="Buscar por título o contenido…"
          value={s.query}
          onChangeText={(query) => store.configure({ query })}
        />
        <FilterChips
          options={["Todas", ...s.folders]}
          value={s.folder}
          onChange={(folder) => store.configure({ folder })}
        />
      </View>
      {s.status === "offline" && (
        <Banner type="warning">
          Sin conexión · Biblioteca local de demostración.
        </Banner>
      )}
      {!!s.tag && (
        <Button
          variant="ghost"
          onPress={() => store.configure({ tag: "" })}
        >{`Quitar etiqueta: ${s.tag}`}</Button>
      )}
      {s.status === "loading" ? (
        <Skeleton rows={5} />
      ) : s.status === "error" || !s.ready ? (
        <>
          <Banner type="danger">
            {s.error || "No se pudo leer la Biblioteca local."}
          </Banner>
          <ErrorState onRetry={() => void store.hydrate()} />
        </>
      ) : (
        <FlatList
          key={s.grid ? "grid" : "list"}
          data={rows}
          numColumns={s.grid ? 2 : 1}
          keyExtractor={(item) => item.id}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          contentContainerStyle={{ paddingBottom: 140 }}
          renderItem={({ item }) => {
            const Icon = item.file?.kind === "image" ? ImageIcon : FileText;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.title}
                onPress={() => openLibraryEntry(store, item.id)}
                style={{
                  flex: 1,
                  minHeight: 64,
                  maxWidth: s.grid ? "50%" : "100%",
                  paddingHorizontal: 16,
                  paddingVertical: 11,
                  flexDirection: s.grid ? "column" : "row",
                  gap: 12,
                  alignItems: s.grid ? "flex-start" : "center",
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: c.wash,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon size={22} color={c.accentInk} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text
                    kind="name"
                    weight="medium"
                    numberOfLines={2}
                    style={{ fontSize: refinementB.nameSize }}
                  >
                    {item.title}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <Text kind="meta" style={{ color: c.text3 }}>
                      {item.file
                        ? `${(item.file.bytes / 1000000).toFixed(1)} MB`
                        : `${Math.max(1, Math.ceil(item.content.length / 1000))} KB`}{" "}
                      · {item.folder}
                    </Text>
                    {item.chat && <Destination kind="chat" />}
                    {item.rag && <Destination kind="rag" />}
                  </View>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              title={
                s.query || s.tag || s.folder !== "Todas"
                  ? "Sin resultados"
                  : "Tu Biblioteca está vacía"
              }
              message={
                s.query || s.tag || s.folder !== "Todas"
                  ? "Prueba con otra carpeta o palabra."
                  : "Agrega catálogos, políticas o preguntas frecuentes."
              }
              action={
                store.canManage ? (
                  <Button onPress={() => openLibraryEntry(store, null)}>
                    Agregar
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
      {store.canManage && s.ready && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Agregar a la Biblioteca"
          onPress={() => openLibraryEntry(store, null)}
          style={{
            position: "absolute",
            right: 18,
            bottom: 100,
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

function Destination({ kind }: { kind: "chat" | "rag" }) {
  const { colors: c } = useTheme(),
    ai = kind === "rag",
    Icon = ai ? Sparkles : MessageCircle;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
        backgroundColor: ai ? c.bubbleAi : c.sunken,
      }}
    >
      <Icon size={13} color={ai ? c.tagText : c.text2} />
      <Text kind="meta" style={{ color: ai ? c.tagText : c.text2 }}>
        {ai ? "IA" : "Chat"}
      </Text>
    </View>
  );
}

function LibraryMenu({ store }: { store: LibraryStore }) {
  const layers = useLayers(),
    [folder, setFolder] = useState(""),
    [error, setError] = useState(""),
    [adding, setAdding] = useState(false);
  const tags = [...new Set(store.snapshot().entries.flatMap((e) => e.tags))];
  const [filtering, setFiltering] = useState(false);
  const add = async () => {
    try {
      await store.addFolder(folder);
      layers.close();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      {store.canManage && (
        <NavRow
          icon={FolderPlus}
          label="Nueva carpeta"
          onPress={() => setAdding(true)}
        />
      )}
      {adding && (
        <>
          <Field
            label="Nombre de carpeta"
            value={folder}
            onChangeText={setFolder}
            maxLength={60}
          />
          <Button onPress={() => void add()}>Crear carpeta</Button>
        </>
      )}
      <NavRow
        icon={Tag}
        label="Filtrar por etiqueta"
        onPress={() => setFiltering(true)}
      />
      {filtering && (
        <>
          {tags.length ? (
            tags.map((tag) => (
              <Button
                key={tag}
                variant="ghost"
                onPress={() => {
                  store.configure({ tag });
                  layers.close();
                }}
              >
                {tag}
              </Button>
            ))
          ) : (
            <Text>No hay etiquetas. Añádelas al editar una entrada.</Text>
          )}
          <Button
            variant="ghost"
            onPress={() => {
              store.configure({ tag: "" });
              layers.close();
            }}
          >
            Todas las etiquetas
          </Button>
        </>
      )}
      {store.canManage && (
        <NavRow
          icon={Plus}
          label="Agregar entrada"
          onPress={() => {
            layers.close();
            openLibraryEntry(store, null);
          }}
        />
      )}
      {!!error && <Banner type="danger">{error}</Banner>}
    </>
  );
}

export function LibraryEditor({
  store,
  entryId,
  onClose,
}: {
  store: LibraryStore;
  entryId: string | null;
  onClose: () => void;
}) {
  const { colors: c } = useTheme();
  const s = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    layers = useLayers();
  const entry = entryId
    ? (s.entries.find((e) => e.id === entryId) ?? null)
    : null;
  const initial: LibraryDraft = {
    id: entry?.id,
    expectedVersion: entry?.version,
    title: entry?.title ?? "",
    content: entry?.content ?? "",
    file: entry?.file ?? null,
    folder: entry?.folder ?? s.folders[0]!,
    tags: entry?.tags ?? [],
    chat: entry?.chat ?? true,
    rag: entry?.rag ?? true,
    knowledge: entry?.knowledge,
  };
  const [draft, setDraft] = useState(initial),
    [tags, setTags] = useState(initial.tags.join(", ")),
    [error, setError] = useState("");
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initial) ||
    tags !== initial.tags.join(", ");
  const canEdit = store.canManage;
  const leave = () =>
    dirty && canEdit
      ? layers.open({
          kind: "dialog",
          title: "¿Descartar cambios?",
          content: (
            <>
              <Text>Los cambios sin guardar se perderán.</Text>
              <Button variant="secondary" onPress={layers.close}>
                Seguir editando
              </Button>
              <Button
                variant="danger"
                onPress={() => {
                  layers.close();
                  onClose();
                }}
              >
                Descartar
              </Button>
            </>
          ),
        })
      : onClose();
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (layers.layer) return false;
      leave();
      return true;
    });
    return () => sub.remove();
  }, [dirty, layers.layer, store]);
  const patch = (value: Partial<LibraryDraft>) =>
    setDraft((d) => ({ ...d, ...value }));
  const save = async () => {
    try {
      await store.save({
        ...draft,
        tags: [
          ...new Set(
            tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ],
      });
      onClose();
      layers.toast("Entrada guardada localmente");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = () =>
    entry &&
    layers.open({
      kind: "dialog",
      title: "¿Borrar entrada?",
      content: (
        <>
          <Text>Se eliminará de esta Biblioteca ficticia.</Text>
          <Button variant="secondary" onPress={layers.close}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onPress={() => {
              void store
                .remove(entry.id, entry.version)
                .then(() => {
                  layers.close();
                  onClose();
                })
                .catch((e) => {
                  layers.close();
                  setError(e.message);
                });
            }}
          >
            Borrar
          </Button>
        </>
      ),
    });
  const filePicker = () =>
    layers.open({
      kind: "sheet",
      title: "Archivo de demostración",
      content: (
        <>
          <Text>
            Solo muestras locales. No se accede a archivos del teléfono.
          </Text>
          {librarySamples.map((file) => (
            <NavRow
              key={file.kind}
              label={`Muestra ${file.kind === "image" ? "imagen" : file.kind.toUpperCase()}`}
              onPress={() => {
                patch({ file });
                layers.close();
              }}
            />
          ))}
          <Button
            variant="ghost"
            onPress={() => {
              patch({ file: null });
              layers.close();
            }}
          >
            Sin archivo
          </Button>
        </>
      ),
    });
  return (
    <>
      <AppBar
        title={canEdit ? "Editar entrada" : "Entrada de la Biblioteca"}
        onBack={leave}
        actions={
          canEdit && entry ? (
            <IconButton icon={Trash2} label="Borrar entrada" onPress={remove} />
          ) : undefined
        }
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 140,
          gap: 14,
        }}
      >
        {!canEdit && (
          <Banner>
            Solo lectura · tu perfil no puede gestionar conocimientos.
          </Banner>
        )}
        <Field
          label="Título"
          value={draft.title}
          editable={canEdit && !s.saving}
          maxLength={180}
          onChangeText={(title) => patch({ title })}
        />
        <Field
          label="Contenido"
          value={draft.content}
          editable={canEdit && !s.saving}
          multiline
          maxLength={20000}
          style={{ minHeight: 96, textAlignVertical: "top" }}
          onChangeText={(content) => patch({ content })}
          placeholder="Agrega un contenido de texto o un archivo."
        />
        <View
          style={{
            borderWidth: 1,
            borderRadius: 16,
            paddingHorizontal: 12,
            paddingBottom: 8,
            borderColor: c.border,
          }}
        >
          <NavRow
            icon={FileUp}
            label={draft.file?.name ?? "Agregar archivo (opcional)"}
            onPress={canEdit ? filePicker : () => {}}
          />
          <Text kind="meta">
            {draft.file
              ? `${(draft.file.bytes / 1000000).toFixed(1)} MB`
              : "Archivo opcional · muestra local"}
          </Text>
        </View>
        <Section>Destinos</Section>
        <Card>
          {canEdit ? (
            <>
              <Switch
                label="💬 Envío en chat"
                value={draft.chat}
                onChange={(chat) => patch({ chat })}
              />
              <Switch
                label="🤖 Lectura IA (RAG)"
                value={draft.rag}
                onChange={(rag) => patch({ rag })}
              />
            </>
          ) : (
            <>
              <Text>💬 Envío en chat: {draft.chat ? "Sí" : "No"}</Text>
              <Text>🤖 Lectura IA (RAG): {draft.rag ? "Sí" : "No"}</Text>
            </>
          )}
        </Card>
        {!draft.chat && !draft.rag && (
          <Banner type="danger">Elige al menos un destino.</Banner>
        )}
        <PickerRow
          label="Carpeta"
          value={draft.folder}
          onPress={
            canEdit
              ? () =>
                  layers.open({
                    kind: "sheet",
                    title: "Carpeta",
                    content: (
                      <>
                        {s.folders.map((folder) => (
                          <Button
                            key={folder}
                            variant="ghost"
                            onPress={() => {
                              patch({ folder });
                              layers.close();
                            }}
                          >
                            {folder}
                          </Button>
                        ))}
                      </>
                    ),
                  })
              : () => {}
          }
        />
        {draft.rag && (
          <PickerRow
            label="Grupo de documentos"
            value={draft.knowledge?.group ?? "General"}
            onPress={() =>
              layers.open({
                kind: "sheet",
                title: "Grupo de documentos",
                content: (
                  <>
                    {s.knowledgeGroups.map((group) => (
                      <Button
                        key={group}
                        variant="ghost"
                        onPress={() => {
                          patch({
                            knowledge: {
                              ...(draft.knowledge ?? knowledgeDefaults),
                              group,
                            },
                          });
                          layers.close();
                        }}
                      >
                        {group}
                      </Button>
                    ))}
                  </>
                ),
              })
            }
          />
        )}
        <Field
          label="Etiquetas (opcional)"
          hint="Sepáralas con comas."
          value={tags}
          editable={canEdit && !s.saving}
          onChangeText={setTags}
          maxLength={800}
        />
        {!!(error || s.error) && (
          <Banner type="danger">{error || s.error}</Banner>
        )}
        {canEdit && (
          <Button
            loading={s.saving}
            disabled={!draft.chat && !draft.rag}
            onPress={() => void save()}
          >
            Guardar
          </Button>
        )}
      </ScrollView>
    </>
  );
}

function openLibraryEntry(store: LibraryStore, id: string | null) {
  store.open(id);
  router.push(`/library/${id ?? "new"}`);
}
