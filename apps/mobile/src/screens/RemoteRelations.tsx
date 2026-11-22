import React, { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, View } from "react-native";
import { AppBar, SegmentedControl } from "../components/ModuleUi";
import { Screen } from "../components/Screen";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  PageScroll,
  PickerRow,
  Text,
} from "../components/ui";
import {
  addCalendarDays,
  businessDate,
} from "../integration/remote-crm-contract";
import {
  RemoteHttpError,
  requiresRemoteLogin,
  type RemoteAuthRepository,
} from "../integration/remote-http";
import type { WireConversation } from "../integration/wire";

type Props = {
  repository: RemoteAuthRepository;
  expired: (error: RemoteHttpError) => void;
  back: () => void;
};

function message(reason: unknown) {
  return reason instanceof RemoteHttpError
    ? reason.message
    : "No se pudo confirmar la respuesta de Dashfort.";
}

function denied(reason: unknown) {
  return (
    reason instanceof RemoteHttpError &&
    reason.status === 403 &&
    !requiresRemoteLogin(reason)
  );
}

function useResource<T>(load: () => Promise<T>, expired: Props["expired"]) {
  const active = useRef(false);
  const inFlight = useRef(false);
  const [data, setData] = useState<T>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState("");

  const fail = useCallback(
    (reason: unknown) => {
      if (!active.current) return;
      if (requiresRemoteLogin(reason)) expired(reason);
      else setError(message(reason));
    },
    [expired],
  );

  const refresh = useCallback(async () => {
    try {
      const result = await load();
      if (active.current) setData(result);
      return true;
    } catch (reason) {
      // In particular, never leave a previously visible contact on screen after a 404.
      if (active.current) setData(undefined);
      fail(reason);
      return false;
    }
  }, [load, fail]);

  const reload = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    if (await refresh()) setUncertain(false);
    inFlight.current = false;
    if (active.current) setBusy(false);
  }, [refresh]);

  useEffect(() => {
    active.current = true;
    void reload();
    return () => {
      active.current = false;
    };
  }, [reload]);

  async function mutate(
    action: () => Promise<string | boolean | null>,
    confirmation: string,
    after?: () => void,
  ) {
    if (inFlight.current || uncertain || !data) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (!active.current || result === null) return;
      after?.();
      setNotice(confirmation);
      if (!(await refresh())) setUncertain(true);
    } catch (reason) {
      const ambiguous =
        !(reason instanceof RemoteHttpError) ||
        reason.status === 0 ||
        reason.status >= 500;
      if (active.current && ambiguous) {
        setUncertain(true);
        setNotice(
          "Actualiza y verifica si se guardó antes de repetir la acción.",
        );
      }
      if (
        active.current &&
        reason instanceof RemoteHttpError &&
        !requiresRemoteLogin(reason) &&
        [403, 404, 409].includes(reason.status)
      ) {
        // Recheck permissions, visibility and availability on a rejected write.
        await refresh();
      }
      fail(reason);
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }

  return { data, busy, error, notice, uncertain, reload, mutate };
}

function Feedback({
  state,
}: {
  state: {
    busy: boolean;
    data?: unknown;
    error: string;
    notice: string;
    reload: () => Promise<void>;
  };
}) {
  return (
    <>
      {state.busy && !state.data && (
        <Text accessibilityLiveRegion="polite">Cargando…</Text>
      )}
      {!!state.notice && <Banner>{state.notice}</Banner>}
      {!!state.error && <Banner type="warning">{state.error}</Banner>}
      <Button
        variant="ghost"
        disabled={state.busy}
        onPress={() => void state.reload()}
      >
        Actualizar
      </Button>
    </>
  );
}

export function RemoteContact({
  repository,
  expired,
  back,
  chat,
  createBooking,
}: Props & { chat: WireConversation; createBooking: () => void }) {
  const id = chat.contact.id;
  const inboxAssigneeId = chat.assignee?.id;
  const load = useCallback(async () => {
    const contact = await repository.contact(id);
    const [notes, tags, team] = await Promise.all([
      repository.notes(id),
      repository.allowSend ? repository.tags() : Promise.resolve([]),
      repository.allowSend ||
      (contact.assignedUserId !== null &&
        contact.assignedUserId !== inboxAssigneeId)
        ? repository.team().catch((reason: unknown) => {
            if (denied(reason)) return null;
            throw reason;
          })
        : Promise.resolve(null),
    ]);
    return { contact, notes, tags, team };
  }, [repository, id, inboxAssigneeId]);
  const resource = useResource(load, expired);
  const [draft, setDraft] = useState("");
  const [panel, setPanel] = useState<"tags" | "assign" | null>(null);
  const { data, busy, uncertain, mutate } = resource;
  const blocked = busy || uncertain;
  const assigned = data?.contact.assignedUserId;
  const assigneeName =
    data?.team?.find((person) => person.id === assigned)?.name ||
    (chat.assignee?.id === assigned ? chat.assignee?.name : undefined);

  return (
    <Screen>
      <AppBar title="Ficha del contacto" onBack={back} />
      <PageScroll>
        <Feedback state={resource} />
        {data && (
          <>
            <Card style={{ gap: 6 }}>
              <Text kind="title" weight="semibold">
                {data.contact.name}
              </Text>
              <Text kind="secondary">
                {data.contact.phone ?? "Sin teléfono registrado"}
              </Text>
              <Text kind="secondary">
                {assigned
                  ? `Asignado a: ${assigneeName || "Nombre no disponible"}`
                  : "Sin asignar"}
              </Text>
              {repository.allowSend && data.team !== null && (
                <Button
                  variant="secondary"
                  disabled={blocked}
                  onPress={() => setPanel(panel === "assign" ? null : "assign")}
                >
                  {panel === "assign"
                    ? "Cerrar asignación"
                    : assigned
                      ? "Reasignar chat"
                      : "Asignar chat"}
                </Button>
              )}
              {panel === "assign" &&
                data.team?.map((person) => (
                  <Button
                    key={person.id}
                    variant="ghost"
                    disabled={blocked || person.id === assigned}
                    onPress={() =>
                      void mutate(
                        () => repository.assign(id, person.id),
                        "Asignación actualizada.",
                        () => setPanel(null),
                      )
                    }
                  >
                    {person.name}
                  </Button>
                ))}
              {panel === "assign" && data.team !== null && !!assigned && (
                <Button
                  variant="ghost"
                  disabled={blocked}
                  onPress={() =>
                    void mutate(
                      () => repository.assign(id, null),
                      "Chat sin asignar.",
                      () => setPanel(null),
                    )
                  }
                >
                  Quitar asignación
                </Button>
              )}
              {repository.allowSend && (
                <Button
                  variant="secondary"
                  disabled={blocked}
                  onPress={createBooking}
                >
                  Agendar cita
                </Button>
              )}
            </Card>
            <Card style={{ gap: 6 }}>
              <Text weight="semibold">Etiquetas</Text>
              <Text kind="secondary">
                {data.contact.tags.map((tag) => tag.name).join(" · ") ||
                  "Sin etiquetas"}
              </Text>
              {repository.allowSend && (
                <Button
                  variant="secondary"
                  disabled={blocked}
                  onPress={() => setPanel(panel === "tags" ? null : "tags")}
                >
                  {panel === "tags" ? "Cerrar etiquetas" : "Editar etiquetas"}
                </Button>
              )}
              {panel === "tags" && data.tags.length === 0 && (
                <Text kind="secondary">Sin etiquetas disponibles.</Text>
              )}
              {panel === "tags" &&
                data.tags.map((tag) => {
                  const selected = data.contact.tags.some(
                    (value) => value.id === tag.id,
                  );
                  return (
                    <Button
                      key={tag.id}
                      variant="ghost"
                      disabled={blocked}
                      onPress={() =>
                        void mutate(
                          () => repository.changeTag(id, tag.id, !selected),
                          "Etiquetas actualizadas.",
                        )
                      }
                    >
                      {`${selected ? "Quitar" : "Agregar"} ${tag.name}`}
                    </Button>
                  );
                })}
            </Card>
            <Card style={{ gap: 8 }}>
              <Text weight="semibold">Notas del contacto</Text>
              {data.notes.length === 0 && (
                <Text kind="secondary">Sin notas.</Text>
              )}
              {data.notes.map((note) => (
                <View key={note.id}>
                  <Text kind="meta">
                    {note.initial ? "Nota inicial · " : ""}
                    {new Date(note.at).toLocaleString("es-MX")}
                  </Text>
                  <Text>{note.text}</Text>
                </View>
              ))}
              {repository.allowSend && (
                <>
                  <Field
                    label="Nueva nota"
                    value={draft}
                    onChangeText={setDraft}
                    multiline
                    maxLength={4_000}
                    editable={!busy}
                  />
                  <Button
                    disabled={!draft.trim() || blocked}
                    onPress={() =>
                      void mutate(
                        () => repository.addNote(id, draft),
                        "Nota guardada.",
                        () => setDraft(""),
                      )
                    }
                  >
                    Guardar nota
                  </Button>
                </>
              )}
            </Card>
          </>
        )}
      </PageScroll>
    </Screen>
  );
}

export function RemoteTasks({ repository, expired, back }: Props) {
  const load = useCallback(() => repository.tasks(), [repository]);
  const resource = useResource(load, expired);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const { data, busy, uncertain, mutate } = resource;
  const blocked = busy || uncertain;
  return (
    <Screen>
      <AppBar title="Tareas" onBack={back} />
      <PageScroll>
        <Feedback state={resource} />
        {data && repository.allowSend && (
          <Card style={{ gap: 8 }}>
            <Field
              label="Nueva tarea"
              value={title}
              onChangeText={setTitle}
              maxLength={200}
              editable={!busy}
            />
            <Field
              label="Descripción"
              value={description}
              onChangeText={setDescription}
              maxLength={4_000}
              multiline
              editable={!busy}
            />
            <Button
              disabled={blocked || !title.trim()}
              onPress={() =>
                void mutate(
                  () => repository.addTask(title, description),
                  "Tarea creada.",
                  () => {
                    setTitle("");
                    setDescription("");
                  },
                )
              }
            >
              Crear tarea
            </Button>
          </Card>
        )}
        {data?.length === 0 && (
          <EmptyState
            title="Sin tareas"
            message="Aquí aparecerán las tareas a las que tienes acceso."
          />
        )}
        {data?.map((task) => (
          <Card key={task.id} style={{ gap: 6 }}>
            <Text weight="semibold">{task.title}</Text>
            {!!task.description && (
              <Text kind="secondary">{task.description}</Text>
            )}
            <Text kind="meta">
              {task.doneAt ? "Completada" : "Pendiente"}
              {task.assignee?.name ? ` · ${task.assignee.name}` : ""}
            </Text>
            {repository.allowSend && task.canEdit && (
              <Button
                variant="secondary"
                disabled={blocked}
                onPress={() =>
                  void mutate(
                    () => repository.setTaskDone(task.id, !task.doneAt),
                    task.doneAt ? "Tarea reabierta." : "Tarea completada.",
                  )
                }
              >
                {task.doneAt ? "Reabrir" : "Completar"}
              </Button>
            )}
          </Card>
        ))}
      </PageScroll>
    </Screen>
  );
}

const agendaViews = [
  { key: "day", label: "Día" },
  { key: "week", label: "Semana" },
];
export function RemoteAgenda(props: Props) {
  const [selection, setSelection] = useState({ offset: 0, view: "day" });
  const { offset, view } = selection;
  return (
    <AgendaRange
      key={`${offset}:${view}`}
      {...props}
      offset={offset}
      week={view === "week"}
      select={(shift, next) => setSelection({ offset: shift, view: next })}
    />
  );
}

const statusLabel: Record<string, string> = {
  agendada: "Agendada",
  realizada: "Realizada",
  no_show: "No asistió",
  cancelada: "Cancelada",
};

function AgendaRange({
  repository,
  expired,
  back,
  offset,
  week,
  select,
}: Props & {
  offset: number;
  week: boolean;
  select: (offset: number, view: string) => void;
}) {
  const [bookingId, setBookingId] = useState<string>();
  const zones = useRef<string>(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const load = useCallback(async () => {
    const from = addCalendarDays(businessDate(zones.current), offset);
    const loadRange = (start: string) =>
      repository.calendar(start, addCalendarDays(start, week ? 6 : 0));
    let result = await loadRange(from);
    zones.current = result.timezone;
    // Local midnight can differ from the business's calendar date.
    const actual = addCalendarDays(businessDate(result.timezone), offset);
    if (actual !== from) result = await loadRange(actual);
    return {
      ...result,
      from: actual,
      to: addCalendarDays(actual, week ? 6 : 0),
    };
  }, [offset, week, repository]);
  const resource = useResource(load, expired);
  const { data, busy } = resource;
  const closeMove = useCallback(() => {
    setBookingId(undefined);
    void resource.reload();
  }, [resource.reload]);
  useEffect(() => {
    if (!bookingId) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeMove();
      return true;
    });
    return () => sub.remove();
  }, [bookingId, closeMove]);
  if (bookingId)
    return (
      <BookingSlots
        repository={repository}
        expired={expired}
        back={closeMove}
        title="Mover cita"
        save={(start) => repository.moveBooking(bookingId, start)}
      />
    );
  return (
    <Screen>
      <AppBar title="Agenda" onBack={back} />
      <PageScroll>
        <SegmentedControl
          fixedGeometry
          value={week ? "week" : "day"}
          options={agendaViews}
          onChange={(view) => select(offset, view)}
        />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Button
            variant="ghost"
            disabled={busy || offset <= -350}
            onPress={() =>
              select(offset - (week ? 7 : 1), week ? "week" : "day")
            }
          >
            Anterior
          </Button>
          <Button
            variant="ghost"
            disabled={busy || offset >= 350}
            onPress={() =>
              select(offset + (week ? 7 : 1), week ? "week" : "day")
            }
          >
            Siguiente
          </Button>
        </View>
        {data && (
          <Text kind="meta">
            {data.from}
            {week ? ` a ${data.to}` : ""} · {data.timezone}
          </Text>
        )}
        <Feedback state={resource} />
        {data?.truncated && (
          <Banner type="warning">Hay más citas. Acorta el rango.</Banner>
        )}
        {data?.bookings.length === 0 && (
          <EmptyState
            title="Sin citas en este rango"
            message="Selecciona otro día o semana."
          />
        )}
        {data?.bookings.map((booking) => (
          <Card key={booking.id} style={{ gap: 6 }}>
            <Text weight="semibold">
              {booking.contact?.name ||
                (booking.kind === "block" ? "Bloqueo" : "Cita")}
            </Text>
            <Text kind="secondary">
              {booking.date} · {booking.time} ·{" "}
              {statusLabel[booking.status] ?? "Estado desconocido"}
            </Text>
            {repository.allowSend &&
              booking.kind === "session" &&
              booking.status === "agendada" &&
              booking.scheduledAt > new Date().toISOString() && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onPress={() => setBookingId(booking.id)}
                >
                  Mover cita
                </Button>
              )}
          </Card>
        ))}
      </PageScroll>
    </Screen>
  );
}

export function BookingSlots({
  repository,
  expired,
  back,
  save,
  title,
}: Props & {
  title: string;
  save: (startUtc: string) => Promise<string | boolean | null>;
}) {
  const load = useCallback(() => repository.slots(), [repository]);
  const resource = useResource(load, expired);
  const [selected, setSelected] = useState<string>();
  const [saved, setSaved] = useState(false);
  const slot = resource.data?.find(
    (candidate) => candidate.startUtc === selected,
  );
  return (
    <Screen>
      <AppBar title={title} onBack={back} />
      <PageScroll>
        <Feedback state={resource} />
        {saved ? (
          <Button onPress={back}>Volver</Button>
        ) : (
          <>
            {resource.data?.length === 0 && (
              <EmptyState
                title="Sin horarios disponibles"
                message="Actualiza para consultar los horarios del negocio."
              />
            )}
            {resource.data?.map((slot) => (
              <PickerRow
                key={slot.startUtc}
                label={`${slot.date} · ${slot.time}`}
                value={selected === slot.startUtc ? "Seleccionado" : ""}
                onPress={() => {
                  if (!resource.busy && !resource.uncertain)
                    setSelected(slot.startUtc);
                }}
              />
            ))}
            <Button
              disabled={!slot || resource.busy || resource.uncertain}
              onPress={() => {
                if (slot)
                  void resource.mutate(
                    () => save(slot.startUtc),
                    "Cita guardada.",
                    () => setSaved(true),
                  );
              }}
            >
              {slot
                ? `Confirmar ${slot.date} · ${slot.time}`
                : "Selecciona un horario"}
            </Button>
          </>
        )}
      </PageScroll>
    </Screen>
  );
}
