import React, { useCallback, useRef, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import {
  BookOpen,
  Camera,
  Contact,
  FileText,
  Image,
  MapPin,
  WandSparkles,
  List,
  Minus,
  Plus,
  Send,
  Zap,
} from "lucide-react-native";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  FilterChips,
  NavRow,
  SearchBox,
  Section,
  Text,
} from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { type ChatStore } from "./core";
import { useChatState } from "./context";
import {
  samples,
  templates,
  fillTemplate,
  quickReplies,
  library,
  libraryEntry,
  validateAttachment,
  type Attachment,
  type Sender,
  DemoTransport,
} from "./model";
import { SamplePicture } from "./Picture";
export function useAction() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const run = useCallback(async (fn: () => unknown | Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo completar la acción.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }, []);
  return { error, busy, run };
}
export function AttachmentPreview({
  chat,
  sample,
}: {
  chat: ChatStore;
  sample: Attachment;
}) {
  const [attachment, setAttachment] = useState(sample);
  const [caption, setCaption] = useState("");
  const action = useAction();
  const { close } = useLayers();
  let problem = "";
  try {
    validateAttachment(attachment);
  } catch (e) {
    problem = (e as Error).message;
  }
  return (
    <>
      {attachment.kind === "image" ? (
        <SamplePicture height={180} />
      ) : (
        <Card>
          <Text weight="semibold">{attachment.name}</Text>
          <Text kind="secondary">
            Muestra de{" "}
            {attachment.kind === "video"
              ? "video"
              : attachment.kind === "contact"
                ? "contacto"
                : attachment.kind === "location"
                  ? "ubicación"
                  : "documento"}
          </Text>
        </Card>
      )}
      <Text>
        {attachment.name} · {(attachment.bytes / 1024 / 1024).toFixed(2)} MB
      </Text>
      <Text kind="meta">
        Adjunto ficticio. No se abre ningún archivo de tu teléfono.
      </Text>
      {!!problem && <Banner type="danger">{problem}</Banner>}
      {!attachment.readable && (
        <Button
          variant="secondary"
          onPress={() => setAttachment({ ...attachment, readable: true })}
        >
          Volver a cargar muestra
        </Button>
      )}
      <Field
        label="Pie del adjunto"
        value={caption}
        onChangeText={setCaption}
        multiline
        maxLength={1024}
        hint="Hasta 1.024 caracteres."
      />
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button
        loading={action.busy}
        disabled={!!problem}
        onPress={() =>
          void action.run(async () => {
            await chat.send({ text: caption, attachment });
            close();
          })
        }
      >
        Enviar muestra
      </Button>
      <Button variant="secondary" disabled={action.busy} onPress={close}>
        Cancelar
      </Button>
    </>
  );
}
export function AttachmentSheet({
  chat,
  onLibrary,
}: {
  chat: ChatStore;
  onLibrary: () => void;
}) {
  const { open } = useLayers();
  const { colors: c } = useTheme();
  const tiles = [
    { title: "Foto o video", icon: Image, index: 0, color: "#7c5cf0" },
    { title: "Cámara", icon: Camera, index: 0, color: "#e0629a" },
    { title: "Documento", icon: FileText, index: 2, color: "#2f7ee8" },
    { title: "Contacto", icon: Contact, index: 3, color: "#12999d" },
    { title: "Ubicación", icon: MapPin, index: 4, color: "#d97b1c" },
  ];
  const preview = (index: number) =>
    open({
      kind: "sheet",
      title: "Vista previa del adjunto",
      content: <AttachmentPreview chat={chat} sample={samples[index]!} />,
    });
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {tiles.map(({ title, icon: Icon, index, color }) => (
          <Pressable
            accessibilityRole="button"
            key={title}
            accessibilityLabel={title}
            onPress={() => preview(index)}
            style={{
              width: "33.33%",
              minHeight: 108,
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: 4,
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                backgroundColor: color,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon color="#fff" size={26} strokeWidth={1.8} />
            </View>
            <Text kind="capsule" style={{ textAlign: "center" }}>
              {title}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Biblioteca"
          onPress={onLibrary}
          style={{
            width: "33.33%",
            minHeight: 108,
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 4,
          }}
        >
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              backgroundColor: "#4a5568",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BookOpen color="#fff" size={26} />
          </View>
          <Text kind="capsule">Biblioteca</Text>
        </Pressable>
      </View>
      <Section>Muestras de prueba</Section>
      <Button variant="tonal" onPress={() => preview(1)}>
        Video de muestra
      </Button>
      <Button variant="ghost" onPress={() => preview(5)}>
        Probar límite de tamaño
      </Button>
      <Button variant="ghost" onPress={() => preview(6)}>
        Probar error de lectura
      </Button>
      <Text kind="meta" style={{ color: c.text3 }}>
        Las muestras no solicitan acceso a cámara, contactos o ubicación.
      </Text>
    </>
  );
}
export function QuickSheet({ chat, name }: { chat: ChatStore; name: string }) {
  const [query, setQuery] = useState("");
  const { close, open } = useLayers();
  const { colors: c } = useTheme();
  const action = useAction();
  const list = quickReplies.filter(
    (q) =>
      q.shortcut.includes(query.toLowerCase()) ||
      q.body.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <SearchBox
        accessibilityLabel="Buscar respuesta rápida"
        placeholder="Buscar atajo"
        value={query}
        onChangeText={setQuery}
      />
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      {list.map((q) => (
        <Pressable
          accessibilityRole="button"
          key={q.shortcut}
          accessibilityLabel={`/${q.shortcut} · ${q.body.replace("{nombre}", name.split(" ")[0]!)}`}
          style={{
            minHeight: 82,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 8,
          }}
          onPress={() =>
            void action.run(() => {
              const previous = chat.snapshot().draft;
              const text = q.body.replace("{nombre}", name.split(" ")[0]!);
              chat.setDraft(
                previous.startsWith("/")
                  ? text
                  : `${previous}${previous ? " " : ""}${text}`,
              );
              close();
            })
          }
        >
          <Zap color={c.text2} size={22} strokeWidth={1.8} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text weight="medium">/{q.shortcut}</Text>
            <Text kind="secondary" style={{ color: c.text3 }}>
              {q.body}
            </Text>
          </View>
        </Pressable>
      ))}
      {!list.length && (
        <EmptyState title="Sin respuestas" message="Prueba otro atajo." />
      )}
      <NavRow
        icon={BookOpen}
        label="Conocimientos y Biblioteca"
        onPress={() =>
          open({
            kind: "sheet",
            title: "Enviar de la Biblioteca",
            content: <LibrarySheet chat={chat} />,
          })
        }
      />
    </>
  );
}
export function LibrarySheet({ chat }: { chat: ChatStore }) {
  const [query, setQuery] = useState("");
  const { colors: c } = useTheme();
  const { height } = useWindowDimensions();
  const { close, open } = useLayers();
  const action = useAction();
  const list = library.filter(
    (item) =>
      item.chat &&
      `${item.name} ${item.text ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <View style={{ minHeight: height * 0.62 }}>
      <SearchBox
        accessibilityLabel="Buscar en Biblioteca"
        placeholder="Buscar por título o contenido"
        value={query}
        onChangeText={setQuery}
      />
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      {list.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={item.name}
          style={{
            minHeight: 76,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 10,
          }}
          onPress={() =>
            void action.run(() => {
              const entry = libraryEntry(item.id);
              if (entry.attachment)
                open({
                  kind: "sheet",
                  title: "Vista previa del adjunto",
                  content: (
                    <AttachmentPreview chat={chat} sample={entry.attachment} />
                  ),
                });
              else {
                chat.setDraft(
                  `${chat.snapshot().draft}${chat.snapshot().draft ? "\n" : ""}${entry.text}`,
                );
                close();
              }
            })
          }
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
            {item.attachment?.kind === "image" ? (
              <Image size={22} color={c.accentInk} />
            ) : (
              <FileText size={22} color={c.accentInk} />
            )}
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text weight="medium">{item.name}</Text>
            <Text kind="secondary" style={{ color: c.text3 }}>
              {item.id === "policy"
                ? "Políticas · 3 KB"
                : item.id === "prices"
                  ? "Catálogos · 640 KB"
                  : "Catálogos · 2.4 MB"}
            </Text>
          </View>
          <Send size={22} color={c.text2} strokeWidth={1.8} />
        </Pressable>
      ))}
      {!list.length && (
        <EmptyState
          title="Sin materiales"
          message="Solo se ofrece material habilitado para envío en chat."
        />
      )}
    </View>
  );
}
export function TemplateSheet({
  chat,
  name,
}: {
  chat: ChatStore;
  name: string;
}) {
  const [id, setId] = useState("recordatorio_cita");
  const [person, setPerson] = useState(name.split(" ")[0] ?? "Cliente");
  const [day, setDay] = useState("martes 11");
  const [time, setTime] = useState("10:00");
  const { close } = useLayers();
  const action = useAction();
  let preview = "";
  let invalid = "";
  try {
    preview = fillTemplate(id, [person, day, time]);
  } catch (e) {
    invalid = (e as Error).message;
  }
  return (
    <>
      <Banner type="warning">
        Una plantilla aprobada permite enviar fuera de la ventana de 24 h. La
        ventana se abre cuando el cliente responde.
      </Banner>
      <FilterChips
        options={templates.filter((t) => t.approved).map((t) => t.id)}
        value={id}
        onChange={setId}
      />
      <Field
        label="Nombre para plantilla"
        value={person}
        onChangeText={setPerson}
        maxLength={200}
      />
      {id === "recordatorio_cita" && (
        <>
          <Field
            label="Día de la cita"
            value={day}
            onChangeText={setDay}
            maxLength={200}
          />
          <Field
            label="Hora de la cita"
            value={time}
            onChangeText={setTime}
            maxLength={200}
          />
        </>
      )}
      <Card>
        <Text>{preview || invalid}</Text>
      </Card>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" disabled={action.busy} onPress={close}>
            Cancelar
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            disabled={!!invalid}
            loading={action.busy}
            onPress={() =>
              void action.run(async () => {
                await chat.send({
                  text: "",
                  templateId: id,
                  variables: [person, day, time],
                });
                close();
              })
            }
          >
            Enviar plantilla de prueba
          </Button>
        </View>
      </View>
    </>
  );
}
export function EmojiSheet({
  onInsert,
}: {
  onInsert: (value: string) => void;
}) {
  const { close } = useLayers();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      {[
        "😀",
        "😊",
        "😉",
        "😍",
        "🙌",
        "👍",
        "🙏",
        "🎉",
        "✨",
        "🔥",
        "💬",
        "📎",
        "✅",
        "❌",
        "📍",
        "📅",
        "💳",
        "🛍️",
        "🎁",
        "😅",
        "🤝",
        "❤️",
      ].map((value) => (
        <Pressable
          key={value}
          accessibilityRole="button"
          accessibilityLabel={`Insertar emoji ${value}`}
          onPress={() => {
            onInsert(value);
            close();
          }}
          style={{
            width: "16.66%",
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 24, lineHeight: 32 }}>{value}</Text>
        </Pressable>
      ))}
    </View>
  );
}
export function RewriteSheet({
  chat,
  onApply,
}: {
  chat: ChatStore;
  onApply: (text: string) => void;
}) {
  const original = chat.snapshot().draft;
  const [preview, setPreview] = useState(original);
  const [mode, setMode] = useState("");
  const { colors: c } = useTheme();
  const { close } = useLayers();
  const choose = (mode: string) => {
    setMode(mode);
    const normalized = original.trim().replace(/\s+/g, " ");
    setPreview(
      (mode === "Mejorar redacción"
        ? normalized.charAt(0).toUpperCase() +
          normalized.slice(1) +
          (/[.!?]$/.test(normalized) ? "" : ".")
        : mode === "Resumir"
          ? normalized.slice(0, 220)
          : mode === "Hacer más corto"
            ? normalized.slice(0, 120)
            : mode === "Hacer más largo"
              ? normalized + " Quedo al pendiente para cualquier duda."
              : mode === "Formal"
                ? "Con gusto, " + normalized
                : mode === "Casual"
                  ? normalized + " 😊"
                  : "Entiendo lo que necesitas. " + normalized
      ).slice(0, 65536),
    );
  };
  return (
    <>
      <Text>
        Vista previa de demostración. No consume IA y no cambia tu borrador
        hasta tocar Aplicar.
      </Text>
      {[
        { label: "Mejorar redacción", Icon: WandSparkles },
        { label: "Resumir", Icon: List },
        { label: "Hacer más corto", Icon: Minus },
        { label: "Hacer más largo", Icon: Plus },
      ].map(({ label, Icon }) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          onPress={() => choose(label)}
          style={{
            minHeight: 52,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Icon size={22} color={c.text2} strokeWidth={1.8} />
          <Text>{label}</Text>
        </Pressable>
      ))}
      <Section>Cambiar el tono</Section>
      <FilterChips
        options={["Formal", "Casual", "Empático"]}
        value={mode}
        onChange={choose}
      />
      {!!mode && (
        <>
          <Field
            label="Vista previa de redacción"
            value={preview}
            onChangeText={setPreview}
            multiline
            maxLength={65536}
            style={{ maxHeight: 180 }}
          />
          <Button
            disabled={!preview.trim()}
            onPress={() => {
              onApply(preview);
              close();
            }}
          >
            Aplicar al borrador
          </Button>
        </>
      )}
      <Button variant="secondary" onPress={close}>
        Cancelar
      </Button>
    </>
  );
}
export function DeleteSheet({
  chat,
  onDeleted,
}: {
  chat: ChatStore;
  onDeleted: () => void;
}) {
  const action = useAction();
  const { close } = useLayers();
  return (
    <>
      <Text>
        Se borran los mensajes y archivos ficticios de este chat. El contacto y
        el trato se conservan. No se puede deshacer.
      </Text>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <Button variant="secondary" disabled={action.busy} onPress={close}>
        Cancelar
      </Button>
      <Button
        variant="danger"
        loading={action.busy}
        onPress={() =>
          void action.run(async () => {
            await chat.remove();
            close();
            onDeleted();
          })
        }
      >
        Eliminar chat de prueba
      </Button>
    </>
  );
}
export function ChatDemoSheet({ chat }: { chat: ChatStore }) {
  const s = useChatState(chat);
  const { close, toast } = useLayers();
  const action = useAction();
  const run = (fn: () => void) => {
    fn();
    close();
  };
  return (
    <>
      <Text kind="secondary">
        Pruebas ficticias. Ningún mensaje sale de esta aplicación.
      </Text>
      {!!action.error && <Banner type="danger">{action.error}</Banner>}
      <NavRow
        label="Cerrar ventana de 24 horas"
        onPress={() => run(chat.closeWindow)}
      />
      {(["in", "ai", "connected", "note", "system"] as Sender[]).map(
        (sender, i) => (
          <NavRow
            key={sender}
            label={
              [
                "Simular mensaje de cliente",
                "Simular respuesta IA",
                "Simular IA conectada",
                "Simular nota interna",
                "Simular evento",
              ][i]!
            }
            onPress={() => run(() => chat.receive(sender))}
          />
        ),
      )}
      <NavRow
        label="Fallar el próximo envío"
        onPress={() =>
          run(() => {
            if (chat.transport instanceof DemoTransport)
              chat.transport.nextFailure = "before";
            toast("El próximo envío de prueba fallará");
          })
        }
      />
      <NavRow
        label="Perder confirmación del próximo envío"
        onPress={() =>
          run(() => {
            if (chat.transport instanceof DemoTransport)
              chat.transport.nextFailure = "ack";
            toast("Se simulará una confirmación perdida");
          })
        }
      />
      <NavRow
        label="Fallar la próxima página"
        onPress={() =>
          run(() => {
            chat.failNextPage = true;
          })
        }
      />
      {(["normal", "loading", "empty", "error", "offline"] as const).map(
        (view, i) => (
          <NavRow
            key={view}
            label={
              [
                "Mostrar chat normal",
                "Mostrar cargando",
                "Mostrar vacío",
                "Mostrar error",
                "Mostrar sin conexión",
              ][i]!
            }
            onPress={() =>
              run(() =>
                view === "normal" ? chat.reconnect() : chat.setView(view),
              )
            }
          />
        ),
      )}
      <Text kind="meta">
        {s.messages.length} mensajes cargados · Borrador guardado por perfil.
      </Text>
    </>
  );
}
