import { StudioBubble, StudioComposer } from "./StudioBubble";
import React, { useRef, useState, useSyncExternalStore } from "react";
import { View, Pressable } from "react-native";
import { router } from "expo-router";
import {
  Archive,
  Layers,
  Pause,
  Pencil,
  Plus,
  Sparkles,
  Star,
} from "lucide-react-native";
import {
  Banner,
  Button,
  Card,
  Composer,
  EmptyState,
  Field,
  MessageBubble,
  NavRow,
  Section,
  Text,
} from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import type { StudioStore, Decision } from "./core";
import { useStudioAction } from "./hooks";
function useData(store: StudioStore) {
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return useSyncExternalStore(
    store.library.subscribe,
    store.library.snapshot,
    store.library.snapshot,
  );
}
export function AgentsMenu({ store }: { store: StudioStore }) {
  const layers = useLayers(),
    action = useStudioAction();
  return (
    <>
      <NavRow
        icon={Pause}
        label="Pausar todos los agentes"
        onPress={() =>
          layers.open({
            kind: "dialog",
            title: "¿Pausar todos los agentes de IA?",
            content: <PauseAllDialog store={store} />,
          })
        }
      />
      <NavRow
        icon={Sparkles}
        label="Crear con el asistente"
        onPress={() => {
          layers.close();
          router.push("/studio-create");
        }}
      />
      <NavRow
        icon={Plus}
        label="Nuevo agente en blanco"
        onPress={() =>
          void action.run(async () => {
            const id = await store.create();
            layers.close();
            router.push(`/studio-agent/${id}`);
          })
        }
      />
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
    </>
  );
}
export function AgentMenu({ store, id }: { store: StudioStore; id: string }) {
  useData(store);
  const layers = useLayers(),
    action = useStudioAction();
  let a;
  try {
    a = store.get(id);
  } catch {
    return (
      <EmptyState
        title="Agente no disponible"
        message="El agente fue archivado o el acceso cambió."
      />
    );
  }
  return (
    <View pointerEvents={action.pending ? "none" : "auto"}>
      <NavRow
        icon={Pencil}
        label="Renombrar"
        onPress={() =>
          layers.open({
            kind: "sheet",
            title: "Renombrar",
            content: <RenameSheet store={store} id={id} />,
          })
        }
      />
      <NavRow
        icon={Layers}
        label="Versiones publicadas"
        onPress={() =>
          layers.open({
            kind: "sheet",
            title: "Versiones publicadas",
            content: <VersionsSheet store={store} id={id} />,
          })
        }
      />
      <NavRow
        icon={Star}
        label="Hacer general a este agente"
        onPress={() =>
          layers.open({
            kind: "dialog",
            title: "¿Hacer general a este agente?",
            content: <GeneralDialog store={store} id={id} />,
          })
        }
      />
      <NavRow
        icon={Pause}
        label={a.paused ? "Reanudar este agente" : "Pausar este agente"}
        onPress={() =>
          void action.run(async () => {
            await store.pause(id, a.revision, !a.paused);
            layers.close();
          })
        }
      />
      <NavRow
        icon={Archive}
        label="Archivar agente"
        onPress={() =>
          layers.open({
            kind: "dialog",
            title: "Archivar agente",
            content: <ArchiveDialog store={store} id={id} />,
          })
        }
      />
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
    </View>
  );
}
function RenameSheet({ store, id }: { store: StudioStore; id: string }) {
  const a = store.get(id),
    base = useRef(a.revision),
    [name, setName] = useState(a.name),
    action = useStudioAction(),
    { close } = useLayers();
  return (
    <>
      <Field
        label="Nombre interno"
        value={name}
        onChangeText={setName}
        maxLength={120}
        editable={!action.pending}
      />
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button
        disabled={action.pending}
        onPress={() =>
          void action.run(async () => {
            await store.rename(id, base.current, name);
            close();
          })
        }
      >
        Guardar
      </Button>
    </>
  );
}
function GeneralDialog({ store, id }: { store: StudioStore; id: string }) {
  const a = store.get(id),
    base = useRef(a.revision),
    action = useStudioAction(),
    { close } = useLayers();
  return (
    <>
      <Text>
        Será el agente de respaldo para etapas sin asignación. Este cambio es
        solo una simulación local.
      </Text>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button variant="secondary" disabled={action.pending} onPress={close}>
        Cancelar
      </Button>
      <Button
        disabled={action.pending}
        onPress={() =>
          void action.run(async () => {
            await store.makeGeneral(id, base.current);
            close();
          })
        }
      >
        Hacer general
      </Button>
    </>
  );
}
export function ArchiveDialog({
  store,
  id,
}: {
  store: StudioStore;
  id: string;
}) {
  const a = store.get(id),
    base = useRef(a.revision),
    [policy, setPolicy] = useState<"general" | "delete">("general"),
    action = useStudioAction(),
    layers = useLayers();
  return (
    <>
      <Text>Qué hacer con sus documentos exclusivos:</Text>
      {(["general", "delete"] as const).map((v) => (
        <Choice
          key={v}
          label={v === "general" ? "Pasarlos a General" : "Borrarlos"}
          checked={policy === v}
          onPress={() => setPolicy(v)}
        />
      ))}
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button
        variant="secondary"
        disabled={action.pending}
        onPress={layers.close}
      >
        Cancelar
      </Button>
      <Button
        variant="danger"
        disabled={action.pending}
        onPress={() =>
          void action.run(async () => {
            await store.archive(id, base.current, policy);
            layers.close();
            router.replace("/(tabs)/studio");
          })
        }
      >
        Archivar
      </Button>
    </>
  );
}
export function PublishDialog({
  store,
  id,
}: {
  store: StudioStore;
  id: string;
}) {
  const a = store.get(id),
    base = useRef(a.revision),
    action = useStudioAction(),
    { close, toast } = useLayers();
  return (
    <>
      <Text>
        Se guardará una versión local simulada. No activa agentes ni cambia la
        atención de clientes reales.
      </Text>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button variant="secondary" disabled={action.pending} onPress={close}>
        Cancelar
      </Button>
      <Button
        disabled={action.pending}
        onPress={() =>
          void action.run(async () => {
            await store.publish(id, base.current);
            close();
            toast("Versión publicada solo en la simulación");
          })
        }
      >
        Publicar
      </Button>
    </>
  );
}
export function PauseAllDialog({ store }: { store: StudioStore }) {
  const action = useStudioAction(),
    { close } = useLayers();
  return (
    <>
      <Text>
        En la simulación, los chats nuevos pasarán a una persona y verás el
        aviso «IA en pausa».
      </Text>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button variant="secondary" disabled={action.pending} onPress={close}>
        Cancelar
      </Button>
      <Button
        variant="danger"
        disabled={action.pending}
        onPress={() =>
          void action.run(async () => {
            await store.pauseAll(true);
            close();
          })
        }
      >
        Pausar
      </Button>
    </>
  );
}
export function VersionsSheet({
  store,
  id,
}: {
  store: StudioStore;
  id: string;
}) {
  useData(store);
  const a = store.get(id),
    layers = useLayers();
  return a.versions.length ? (
    <>
      {[...a.versions].reverse().map((v) => (
        <View
          key={v.number}
          style={{
            flexDirection: "row",
            gap: 12,
            alignItems: "center",
            paddingVertical: 10,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text weight="medium">
              v{v.number} · {new Date(v.at).toLocaleDateString("es-MX")}
            </Text>
            <Text kind="meta">{v.summary}</Text>
          </View>
          <Button
            variant="tonal"
            onPress={() =>
              layers.open({
                kind: "dialog",
                title: "¿Cargar esta versión al borrador?",
                content: <LoadDialog store={store} id={id} number={v.number} />,
              })
            }
          >
            Cargar
          </Button>
        </View>
      ))}
    </>
  ) : (
    <EmptyState
      title="Sin versiones publicadas"
      message="Publica una primera versión local para conservarla aquí."
    />
  );
}
export function LoadDialog({
  store,
  id,
  number,
}: {
  store: StudioStore;
  id: string;
  number: number;
}) {
  const a = store.get(id),
    base = useRef(a.revision),
    action = useStudioAction(),
    layers = useLayers();
  return (
    <>
      <Text>Reemplaza el borrador actual. Lo publicado no cambia.</Text>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button
        variant="secondary"
        disabled={action.pending}
        onPress={() =>
          layers.open({
            kind: "sheet",
            title: "Versiones publicadas",
            content: <VersionsSheet store={store} id={id} />,
          })
        }
      >
        Cancelar
      </Button>
      <Button
        disabled={action.pending}
        onPress={() =>
          void action.run(async () => {
            await store.loadVersion(id, base.current, number);
            layers.close();
          })
        }
      >
        Cargar
      </Button>
    </>
  );
}
export function Choice({
  label,
  checked,
  onPress,
  description,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
  description?: string;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      aria-checked={checked}
      onPress={onPress}
      style={{
        minHeight: 48,
        paddingVertical: 12,
        paddingHorizontal: 4,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderBottomWidth: 1,
        borderColor: c.border,
      }}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text>{label}</Text>
        {description && <Text kind="meta">{description}</Text>}
      </View>
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: checked ? 6 : 1.5,
          borderColor: checked ? c.accent : c.borderStrong,
        }}
      />
    </Pressable>
  );
}
export function PreviewSheet({
  store,
  id,
}: {
  store: StudioStore;
  id: string;
}) {
  const initial = "Hola, ¿tienen anillos de plata?",
    first = store.preview(id, initial),
    [text, setText] = useState(""),
    [pairs, setPairs] = useState<readonly { q: string; r: Decision }[]>([
      { q: initial, r: first },
    ]),
    [error, setError] = useState(""),
    { colors: c } = useTheme(),
    latest = pairs.at(-1)!.r;
  const send = () => {
    try {
      const q = text.trim(),
        r = store.preview(id, q);
      setPairs((p) => [...p, { q, r }].slice(-20));
      setText("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Banner>Es una prueba local: no se envía nada a ningún cliente.</Banner>
      <View
        style={{
          minHeight: 200,
          gap: 12,
          padding: 12,
          borderRadius: 16,
          backgroundColor: c.sunken,
        }}
      >
        {pairs.map((p, i) => (
          <React.Fragment key={i}>
            <StudioBubble text={p.q} />
            <StudioBubble
              text={p.r.answer}
              variant="ai"
              who={`Simulador · ${store.config(id).displayName || "Equipo"}`}
            />
          </React.Fragment>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {[
          `Decisión: ${latest.decision === "handoff" ? "pasar a persona" : "responder"}`,
          "Modelo: simulador local",
          `Tokens simulados: ~${latest.tokens}`,
          `Conocimiento: ${latest.knowledge.join(", ") || "Sin fuentes indexadas"}`,
        ].map((t) => (
          <Text
            key={t}
            kind="meta"
            style={{
              padding: 8,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: c.border,
            }}
          >
            {t}
          </Text>
        ))}
      </View>
      {!!error && <Banner type="danger">{error}</Banner>}
      <StudioComposer value={text} onChange={setText} onSend={send} />
    </>
  );
}
