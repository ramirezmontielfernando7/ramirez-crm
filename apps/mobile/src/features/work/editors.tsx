import { usePeople } from "../team/state";
import React, { useState, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import {
  Banner,
  Button,
  EmptyState,
  Field,
  PickerRow,
  SearchBox,
  Switch,
  Text,
} from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { parseDue, personName, team } from "../contact/model";
import { normalize } from "../inbox/model";
import type { ContactDirectory } from "../contact/core";
import type { WorkTask, WorkNote, NoteColor } from "./core";
export const noteColors = {
  light: {
    am: ["#fff3c4", "#1d1d1f"],
    ve: ["#def3e3", "#1d1d1f"],
    az: ["#e2ebff", "#1d1d1f"],
    bl: ["#f5f5f7", "#1d1d1f"],
  },
  dark: {
    am: ["#4a3d12", "#fff1c0"],
    ve: ["#1d4430", "#d6f5e0"],
    az: ["#1f3566", "#dbe6ff"],
    bl: ["#10172a", "#e8eefc"],
  },
} as const;
function name(dir: ContactDirectory, id: string | null) {
  if (!id) return "Sin contacto";
  try {
    return dir.conversations.get(dir.actor, id).name;
  } catch {
    return "Contacto no disponible";
  }
}
function ContactChoices({
  directory: dir,
  value,
  onChange,
}: {
  directory: ContactDirectory;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = dir.conversations
    .list(dir.actor)
    .filter(
      (c) =>
        !c.archived &&
        !c.campaign &&
        normalize(c.name + c.phone).includes(normalize(query)),
    )
    .slice(0, 30);
  return (
    <View style={{ gap: 4 }}>
      <SearchBox
        accessibilityLabel="Buscar contacto ligado"
        placeholder="Buscar nombre o teléfono…"
        value={query}
        onChangeText={setQuery}
      />
      <Button variant="ghost" onPress={() => onChange(null)}>
        Sin contacto
      </Button>
      {rows.map((c) => (
        <Button
          key={c.id}
          variant={c.id === value ? "tonal" : "ghost"}
          onPress={() => onChange(c.id)}
        >
          {c.name}
        </Button>
      ))}
      {!rows.length && <Text>No hay contactos disponibles.</Text>}
    </View>
  );
}
export function TaskEditor({
  directory: dir,
  initial: t,
}: {
  directory: ContactDirectory;
  initial: WorkTask;
}) {
  const { team, personName } = usePeople();
  const repo = dir.workRepo,
    s = useSyncExternalStore(repo.subscribe, repo.snapshot, repo.snapshot),
    layers = useLayers(),
    d = new Date(t.due);
  const [title, setTitle] = useState(t.title),
    [notes, setNotes] = useState(t.notes),
    [date, setDate] = useState(
      `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
    ),
    [time, setTime] = useState(
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    ),
    [assignee, setAssignee] = useState(t.assignee),
    [contactId, setContact] = useState(t.contactId),
    [expanded, setExpanded] = useState(""),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false),
    [busy, setBusy] = useState(false);
  let allowed = true;
  try {
    repo.getTask(t.id);
  } catch {
    allowed = false;
  }
  const run = async (remove = false) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!remove && contactId) {
        const c = dir.get(contactId);
        await c.hydrate();
        if (!c.snapshot().ready) throw Error(c.snapshot().error);
      }
      if (remove) await repo.removeTask(t.id, t.revision);
      else
        await repo.saveTask({
          id: t.id,
          revision: t.revision,
          title,
          notes,
          due: parseDue(date, time),
          assignee,
          contactId,
        });
      layers.close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!allowed)
    return (
      <EmptyState
        title="Tarea no disponible"
        message="Tu acceso cambió o la tarea fue borrada."
      />
    );
  return (
    <>
      <View pointerEvents={busy ? "none" : "auto"}>
        <Field
          label="Título"
          value={title}
          editable={!busy}
          onChangeText={setTitle}
          maxLength={300}
        />
        <Field
          label="Notas o detalles (opcional)"
          value={notes}
          editable={!busy}
          onChangeText={setNotes}
          multiline
          style={{ minHeight: 96, textAlignVertical: "top" }}
          maxLength={4000}
        />
        <PickerRow
          label="Fecha límite"
          value={`${date} · ${time}`}
          onPress={() => setExpanded(expanded === "date" ? "" : "date")}
        />
        {expanded === "date" && (
          <>
            <Field
              label="Fecha · DD/MM/AAAA"
              value={date}
              editable={!busy}
              onChangeText={setDate}
              maxLength={10}
            />
            <Field
              label="Hora · HH:mm"
              value={time}
              editable={!busy}
              onChangeText={setTime}
              maxLength={5}
            />
          </>
        )}
        <PickerRow
          label="Responsable"
          value={personName(assignee)}
          onPress={() => {
            if (repo.actor.role !== "advisor")
              setExpanded(expanded === "person" ? "" : "person");
          }}
        />
        {expanded === "person" &&
          team.map((p) => (
            <Button
              key={p.id}
              variant={assignee === p.id ? "tonal" : "ghost"}
              onPress={() => {
                setAssignee(p.id);
                setExpanded("");
              }}
            >
              {p.name}
            </Button>
          ))}
        <PickerRow
          label="Contacto"
          value={name(dir, contactId)}
          onPress={() => setExpanded(expanded === "contact" ? "" : "contact")}
        />
        {expanded === "contact" && (
          <ContactChoices
            directory={dir}
            value={contactId}
            onChange={(id) => {
              setContact(id);
              setExpanded("");
            }}
          />
        )}
      </View>
      {!!error && <Banner type="danger">{error}</Banner>}
      {deleting ? (
        <>
          <Text>¿Borrar esta tarea?</Text>
          <Button
            variant="secondary"
            disabled={busy}
            onPress={() => setDeleting(false)}
          >
            Conservar
          </Button>
          <Button
            variant="danger"
            loading={busy || s.saving}
            onPress={() => void run(true)}
          >
            Confirmar borrado
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="danger"
            disabled={busy || s.saving}
            onPress={() => setDeleting(true)}
          >
            Borrar
          </Button>
          <Button loading={busy || s.saving} onPress={() => void run()}>
            Guardar
          </Button>
        </>
      )}
    </>
  );
}
export function NoteEditor({
  directory: dir,
  initial: n,
}: {
  directory: ContactDirectory;
  initial?: WorkNote;
}) {
  const repo = dir.workRepo,
    s = useSyncExternalStore(repo.subscribe, repo.snapshot, repo.snapshot),
    layers = useLayers(),
    { colors: c, dark } = useTheme();
  const [title, setTitle] = useState(n?.title ?? ""),
    [body, setBody] = useState(n?.body ?? ""),
    [color, setColor] = useState<NoteColor>(n?.color ?? "am"),
    [pin, setPin] = useState(n?.pin ?? false),
    [contactId, setContact] = useState(n?.contactId ?? null),
    [picking, setPicking] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false),
    [busy, setBusy] = useState(false);
  let allowed = true;
  if (n)
    try {
      repo.getNote(n.id);
    } catch {
      allowed = false;
    }
  const run = async (remove = false) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!remove && contactId) {
        const contact = dir.get(contactId);
        await contact.hydrate();
        if (!contact.snapshot().ready) throw Error(contact.snapshot().error);
      }
      if (remove && n) await repo.removeNote(n.id, n.revision);
      else
        await repo.saveNote({
          id: n?.id,
          revision: n?.revision,
          title,
          body,
          color,
          pin,
          contactId,
        });
      layers.close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!allowed)
    return (
      <EmptyState
        title="Nota no disponible"
        message="Tu acceso cambió o la nota fue borrada."
      />
    );
  return (
    <>
      <View pointerEvents={busy ? "none" : "auto"} style={{ gap: 10 }}>
        <Field
          label="Título (opcional)"
          value={title}
          editable={!busy}
          onChangeText={setTitle}
          maxLength={300}
        />
        <Field
          label="Escribe una nota…"
          value={body}
          editable={!busy}
          onChangeText={setBody}
          multiline
          maxLength={4000}
          style={{ minHeight: 96, textAlignVertical: "top" }}
        />
        <Text kind="capsule">Color</Text>
        <View
          accessibilityRole="radiogroup"
          style={{ flexDirection: "row", gap: 12 }}
        >
          {(["am", "ve", "az", "bl"] as const).map((v, i) => (
            <Pressable
              key={v}
              disabled={busy}
              accessibilityRole="radio"
              accessibilityLabel={["Amarillo", "Verde", "Azul", "Neutro"][i]}
              accessibilityState={{ checked: color === v, disabled: busy }}
              aria-checked={color === v}
              onPress={() => setColor(v)}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: noteColors[dark ? "dark" : "light"][v][0],
                borderWidth: color === v ? 2 : 1,
                borderColor: color === v ? c.accent : c.borderStrong,
              }}
            />
          ))}
        </View>
        <Switch
          label="Fijar arriba"
          value={pin}
          onChange={(v) => {
            if (!busy) setPin(v);
          }}
        />
        <PickerRow
          label="Chat ligado"
          value={contactId ? name(dir, contactId) : "Ninguno"}
          onPress={() => setPicking(!picking)}
        />
        {picking && (
          <ContactChoices
            directory={dir}
            value={contactId}
            onChange={(id) => {
              setContact(id);
              setPicking(false);
            }}
          />
        )}
      </View>
      {!!error && <Banner type="danger">{error}</Banner>}
      {deleting ? (
        <>
          <Text>¿Borrar esta nota?</Text>
          <Button
            variant="secondary"
            disabled={busy}
            onPress={() => setDeleting(false)}
          >
            Conservar
          </Button>
          <Button
            variant="danger"
            loading={busy || s.saving}
            onPress={() => void run(true)}
          >
            Confirmar borrado
          </Button>
        </>
      ) : (
        <>
          {n && (
            <Button
              variant="danger"
              disabled={busy || s.saving}
              onPress={() => setDeleting(true)}
            >
              Borrar
            </Button>
          )}
          <Button loading={busy || s.saving} onPress={() => void run()}>
            Guardar
          </Button>
        </>
      )}
    </>
  );
}
