import { useFocusEffect } from "expo-router";
import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  useRef,
} from "react";
import { AppState, View, FlatList, Pressable } from "react-native";
import {
  FileText,
  FileUp,
  Folder,
  FolderPlus,
  Trash2,
  Upload,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
import { AppBar, IconButton, FilterChips } from "../../components/ModuleUi";
import {
  Avatar,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  NavRow,
  PickerRow,
  Section,
  Skeleton,
  Text,
} from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { useLayers } from "../../components/Layers";
import { useSession } from "../../state/SessionProvider";
import { canAccess } from "../../domain/access";
import { useInbox, useInboxState } from "../inbox/store";
import { libraryFor } from "../library/state";
import type { LibraryEntry, LibraryFile, LibraryStore } from "../library/core";
import {
  utf8Size,
  knowledgeReaders,
  knowledgeReaderLabel,
  knowledgeStateLabel,
} from "./model";
const views = new WeakMap<LibraryStore, { tab: string; group: string }>();
const tabs = ["Agentes", "Conocimiento", "Asignación", "Pruebas"];
export function KnowledgeScreen() {
  const inbox = useInbox(),
    store = libraryFor(inbox),
    { session, disabled } = useSession();
  return (
    <Screen>
      {!session || !canAccess(session.role, "studio", disabled) ? (
        <EmptyState
          title="Acceso no permitido"
          message="Tu perfil no tiene acceso a Estudio IA."
        />
      ) : (
        <KnowledgeView store={store} />
      )}
    </Screen>
  );
}
function KnowledgeView({ store }: { store: LibraryStore }) {
  const s = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    inbox = useInboxState(),
    saved = views.get(store),
    [tab, setTab] = useState(saved?.tab ?? "Conocimiento"),
    [group, setGroup] = useState(saved?.group ?? "General"),
    [active, setActive] = useState(AppState.currentState !== "background"),
    [focused, setFocused] = useState(false),
    { colors: c } = useTheme(),
    layers = useLayers();
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    views.set(store, { tab, group });
  }, [store, tab, group]);
  useEffect(() => {
    if (s.ready) store.configure({ status: inbox.status });
  }, [store, s.ready, inbox.status]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) =>
      setActive(s === "active"),
    );
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (
      !active ||
      !focused ||
      tab !== "Conocimiento" ||
      !s.ready ||
      s.saving ||
      s.error ||
      !s.entries.some((e) => e.rag && e.knowledge?.status === "processing")
    )
      return;
    const timer = setTimeout(() => {
      if (AppState.currentState !== "background")
        void store.finishKnowledge().catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [store, active, focused, tab, s.ready, s.saving, s.error, s.entries]);
  const rows = useMemo(
    () => (s.ready ? store.knowledgeList(group) : []),
    [store, s.ready, s.entries, s.status, group],
  );
  const upload = () =>
    layers.open({
      kind: "sheet",
      title: "Subir documento",
      content: (
        <UploadSheet
          store={store}
          group={group === "Exclusivos" ? "General" : group}
        />
      ),
    });
  return (
    <>
      <AppBar
        module
        title="Estudio IA"
        actions={
          <IconButton
            icon={FolderPlus}
            label="Nuevo grupo"
            onPress={() =>
              layers.open({
                kind: "sheet",
                title: "Nuevo grupo",
                content: <GroupSheet store={store} />,
              })
            }
          />
        }
      />
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: "row",
          borderBottomWidth: 1,
          borderColor: c.border,
        }}
      >
        {tabs.map((t) => (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            aria-selected={tab === t}
            onPress={() => setTab(t)}
            style={{
              flex: 1,
              minHeight: 48,
              justifyContent: "center",
              alignItems: "center",
              borderBottomWidth: tab === t ? 2 : 0,
              borderColor: c.accent,
            }}
          >
            <Text
              kind="capsule"
              weight="medium"
              style={{ color: tab === t ? c.accentInk : c.text3 }}
            >
              {t}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab !== "Conocimiento" ? (
        <EmptyState
          title={`${tab} · Próximo lote`}
          message="Este apartado todavía no está implementado."
          action={
            <Button variant="tonal" onPress={() => setTab("Conocimiento")}>
              Ir a Conocimiento
            </Button>
          }
        />
      ) : (
        <>
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <FilterChips
              options={[...s.knowledgeGroups, "Exclusivos"]}
              value={group}
              onChange={setGroup}
            />
          </View>
          {s.status === "offline" && (
            <Banner type="warning">
              Sin conexión · documentos ficticios locales.
            </Banner>
          )}
          {s.error && s.ready && <Banner type="danger">{s.error}</Banner>}
          {!s.ready ? (
            s.error ? (
              <ErrorState onRetry={() => void store.hydrate()} />
            ) : (
              <Skeleton rows={4} />
            )
          ) : s.status === "loading" ? (
            <Skeleton rows={4} />
          ) : s.status === "error" ? (
            <ErrorState onRetry={() => store.configure({ status: "normal" })} />
          ) : (
            <FlatList
              testID="knowledge-list"
              data={rows}
              keyExtractor={(e) => e.id}
              initialNumToRender={12}
              windowSize={7}
              contentContainerStyle={{ paddingBottom: 112 }}
              renderItem={({ item: e }) => {
                const info = store.knowledgeInfo(e),
                  color =
                    info.status === "indexed"
                      ? c.success
                      : info.status === "processing"
                        ? c.warning
                        : c.danger;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Documento: ${e.title}`}
                    onPress={() =>
                      layers.open({
                        kind: "sheet",
                        title: e.title,
                        content: <DocumentSheet store={store} initial={e} />,
                      })
                    }
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      borderBottomWidth: 1,
                      borderColor: c.border,
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        backgroundColor: c.sunken,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <FileText size={22} color={c.text3} />
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text kind="name" weight="medium">
                        {e.title}
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          flexWrap: "wrap",
                          gap: 6,
                        }}
                      >
                        <Text kind="meta" style={{ color }}>
                          {knowledgeStateLabel(info.status)}
                        </Text>
                        <Text kind="meta">
                          {size(e)} · {knowledgeReaderLabel(info.reader)}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <EmptyState
                  title="Este grupo está vacío"
                  message="Sube un .pdf, .txt o .md para que la IA lo consulte."
                  action={<Button onPress={upload}>Subir documento</Button>}
                />
              }
              ListFooterComponent={
                <View style={{ padding: 16 }}>
                  <Text kind="meta">
                    Un PDF escaneado sin texto no se puede leer. «Desde la
                    Biblioteca» muestra lo que marcaste con Lectura IA.
                  </Text>
                  {s.error && (
                    <Button
                      variant="ghost"
                      onPress={() =>
                        void store
                          .hydrate()
                          .then(() => store.finishKnowledge())
                          .catch(() => {})
                      }
                    >
                      Reintentar
                    </Button>
                  )}
                </View>
              }
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Subir documento"
            onPress={upload}
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
            <Upload size={24} color={c.onAccent} />
          </Pressable>
        </>
      )}
    </>
  );
}
function size(e: LibraryEntry) {
  const b = e.file?.bytes ?? utf8Size(e.content);
  return b >= 1e6
    ? `${(b / 1e6).toFixed(1)} MB`
    : `${Math.max(1, Math.round(b / 1000))} KB`;
}
const samples: readonly (LibraryFile & { readable: boolean })[] = [
  {
    name: "Manual de producto.pdf",
    kind: "pdf",
    bytes: 5100000,
    readable: true,
  },
  {
    name: "Escaneo sin texto.pdf",
    kind: "pdf",
    bytes: 900000,
    readable: false,
  },
  { name: "Preguntas demo.txt", kind: "txt", bytes: 8000, readable: true },
  { name: "Guía demo.md", kind: "txt", bytes: 3000, readable: true },
];
function UploadSheet({
  store,
  group: initial,
}: {
  store: LibraryStore;
  group: string;
}) {
  const s = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    [file, setFile] = useState<(typeof samples)[number] | null>(null),
    [group, setGroup] = useState(initial),
    [reader, setReader] = useState<string | null>(null),
    [picking, setPicking] = useState(""),
    [error, setError] = useState(""),
    busy = useRef(false),
    { close } = useLayers();
  const save = async () => {
    if (busy.current) return;
    if (!file) {
      setError("Elige un archivo ficticio.");
      return;
    }
    busy.current = true;
    try {
      await store.uploadKnowledge(file, group, reader, file.readable);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  };
  return (
    <View pointerEvents={s.saving ? "none" : "auto"}>
      <Card style={{ borderStyle: "dashed", alignItems: "center" }}>
        <Button
          icon={FileUp}
          variant="tonal"
          disabled={s.saving}
          onPress={() => setPicking(picking === "file" ? "" : "file")}
        >
          {file?.name ?? "Elegir archivo"}
        </Button>
        <Text kind="meta">.pdf, .txt o .md · hasta 20 MB</Text>
      </Card>
      {picking === "file" &&
        samples.map((f) => (
          <Button
            key={f.name}
            variant="ghost"
            disabled={s.saving}
            onPress={() => {
              setFile(f);
              setPicking("");
            }}
          >
            {f.name}
          </Button>
        ))}
      <PickerRow
        label="Grupo"
        value={group}
        onPress={() => setPicking(picking === "group" ? "" : "group")}
      />
      {picking === "group" &&
        s.knowledgeGroups.map((g) => (
          <Button
            key={g}
            variant="ghost"
            disabled={s.saving}
            onPress={() => {
              setGroup(g);
              setPicking("");
            }}
          >
            {g}
          </Button>
        ))}
      <PickerRow
        label="Quién lo lee"
        value={knowledgeReaderLabel(reader)}
        onPress={() => setPicking(picking === "reader" ? "" : "reader")}
      />
      {picking === "reader" &&
        [{ id: null, name: "Todos los agentes" }, ...knowledgeReaders].map(
          (r) => (
            <Button
              key={r.id ?? "all"}
              variant="ghost"
              disabled={s.saving}
              onPress={() => {
                setReader(r.id);
                setPicking("");
              }}
            >
              {r.name}
            </Button>
          ),
        )}
      {!!error && <Banner type="danger">{error}</Banner>}
      <Button variant="secondary" disabled={s.saving} onPress={close}>
        Cancelar
      </Button>
      <Button disabled={s.saving} onPress={() => void save()}>
        Subir
      </Button>
    </View>
  );
}
function DocumentSheet({
  store,
  initial: e,
}: {
  store: LibraryStore;
  initial: LibraryEntry;
}) {
  const s = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    [moving, setMoving] = useState(false),
    [deleting, setDeleting] = useState(false),
    [error, setError] = useState(""),
    { close } = useLayers();
  let current: LibraryEntry;
  try {
    current = store.knowledgeGet(e.id);
  } catch {
    return (
      <EmptyState
        title="Documento no disponible"
        message="Su destino o acceso cambió."
      />
    );
  }
  const info = store.knowledgeInfo(current);
  const run = async (group?: string) => {
    try {
      if (group) await store.moveKnowledge(e.id, e.version, group);
      else await store.removeKnowledge(e.id, e.version);
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Card>
        {[
          ["Estado", knowledgeStateLabel(info.status)],
          ["Tamaño para la IA", size(current)],
          ["Grupo", info.group],
          ["Quién lo lee", knowledgeReaderLabel(info.reader)],
        ].map(([k, v]) => (
          <View key={k} style={{ flexDirection: "row", gap: 12 }}>
            <Text kind="secondary" style={{ flex: 1 }}>
              {k}
            </Text>
            <Text kind="secondary" style={{ flex: 1, textAlign: "right" }}>
              {v}
            </Text>
          </View>
        ))}
      </Card>
      <NavRow
        icon={Folder}
        label="Mover a…"
        onPress={() => setMoving(!moving)}
      />
      {moving &&
        s.knowledgeGroups.map((g) => (
          <Button
            key={g}
            variant="ghost"
            disabled={s.saving}
            onPress={() => void run(g)}
          >
            {g}
          </Button>
        ))}
      <NavRow
        icon={Trash2}
        label="Borrar documento"
        onPress={() => setDeleting(true)}
      />
      {deleting && (
        <>
          <Text>
            {current.chat
              ? "Se quitará Lectura IA; el archivo seguirá disponible para Chat."
              : "Se borrará este documento ficticio y su entrada exclusiva de Lectura IA. No se puede deshacer."}
          </Text>
          <Button
            variant="secondary"
            disabled={s.saving}
            onPress={() => setDeleting(false)}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={s.saving}
            onPress={() => void run()}
          >
            Confirmar borrado
          </Button>
        </>
      )}
      {!!error && <Banner type="danger">{error}</Banner>}
    </>
  );
}
function GroupSheet({ store }: { store: LibraryStore }) {
  const [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    { close } = useLayers();
  return (
    <>
      <Field
        label="Nombre del grupo"
        value={name}
        onChangeText={setName}
        maxLength={60}
      />
      {!!error && <Banner type="danger">{error}</Banner>}
      <Button
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void store
            .addKnowledgeGroup(name)
            .then(close)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Crear grupo
      </Button>
    </>
  );
}
