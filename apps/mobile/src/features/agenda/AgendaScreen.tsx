import React, {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import {
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { router } from "expo-router";
import { CalendarDays, Lock, MoreVertical, Plus } from "lucide-react-native";
import { Screen } from "../../components/Screen";
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
  Skeleton,
  Switch,
  Text,
} from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { useSession } from "../../state/SessionProvider";
import { canAccess } from "../../domain/access";
import { preferencesStorage } from "../../services/storage";
import { useContactDirectory } from "../contact/context";
import { useOptionalInbox } from "../inbox/store";
import {
  AgendaStore,
  weekDays,
  calendarCells,
  dateParts,
  dayLabel,
  timeLabel,
  type Appointment,
} from "./core";
const stores = new WeakMap<object, AgendaStore>();
const back = () =>
  router.canGoBack() ? router.back() : router.replace("/(tabs)/more");
export function AgendaScreen() {
  const inbox = useOptionalInbox(),
    { session, disabled } = useSession();
  const store = useMemo(() => {
    if (!inbox) return null;
    let s = stores.get(inbox);
    if (!s) {
      s = new AgendaStore(inbox.actor, "demo-org-cristal", preferencesStorage);
      stores.set(inbox, s);
    }
    return s;
  }, [inbox]);
  if (!session || !store || !canAccess(session.role, "more", disabled))
    return (
      <Screen>
        <EmptyState
          title="Acceso no permitido"
          message="Tu perfil de prueba no tiene acceso a Agenda."
        />
      </Screen>
    );
  return (
    <Screen keyboard>
      <AgendaView store={store} />
    </Screen>
  );
}

export function AgendaView({ store }: { store: AgendaStore }) {
  const s = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    { colors: c } = useTheme(),
    layers = useLayers();
  const list = useRef<FlatList<Appointment>>(null);
  const restoration = useRef({ offset: store.offset(s.day), busy: true });
  const initialOffset = useMemo(
    () => ({ x: 0, y: store.offset(s.day) }),
    [store, s.day, s.view],
  );
  const restoreScroll = useCallback(() => {
    if (restoration.current.busy)
      list.current?.scrollToOffset({
        offset: restoration.current.offset,
        animated: false,
      });
  }, []);
  useLayoutEffect(() => {
    restoration.current = { offset: store.offset(s.day), busy: true };
    let second: number | undefined;
    if (s.view !== "day" || !s.ready) return;
    const first = requestAnimationFrame(() => {
      restoreScroll();
      second = requestAnimationFrame(() => {
        restoreScroll();
        restoration.current.busy = false;
      });
    });
    return () => {
      restoration.current.busy = true;
      cancelAnimationFrame(first);
      if (second !== undefined) cancelAnimationFrame(second);
    };
  }, [store, s.day, s.view, s.ready, restoreScroll]);
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (layers.layer) return false;
      if (s.view === "month") {
        store.configure({ view: "day" });
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [layers.layer, s.view, store]);
  const block = (row?: Appointment) => {
    if (!s.ready) return;
    layers.open({
      kind: "sheet",
      title: "Bloquear horario",
      content: <BlockForm store={store} initial={row} />,
    });
  };
  const open = (row: Appointment) =>
    row.kind === "block" && !row.cancelled
      ? block(row)
      : layers.open({
          kind: "sheet",
          title: row.title,
          content: <BookingDetail store={store} id={row.id} />,
        });
  const menu = () =>
    layers.open({
      kind: "menu",
      title: "Agenda",
      content: <AgendaMenu store={store} onBlock={() => block()} />,
    });
  if (s.view === "month") return <Month store={store} />;
  const days = weekDays(s.day);
  return (
    <>
      <AppBar
        title="Agenda"
        onBack={back}
        actions={
          <>
            <IconButton
              icon={CalendarDays}
              label="Ver mes"
              onPress={() => store.configure({ view: "month" })}
            />
            <IconButton
              icon={MoreVertical}
              label="Más opciones de Agenda"
              onPress={menu}
            />
          </>
        }
      />
      <DayStrip
        days={days}
        selected={s.day}
        onSelect={(day) => store.selectDay(day)}
      />
      {s.status === "offline" && (
        <Banner type="warning">
          Sin conexión · Agenda local de demostración.
        </Banner>
      )}
      {s.status === "loading" ? (
        <Skeleton rows={4} />
      ) : s.status === "error" || !s.ready ? (
        <>
          <Banner type="danger">
            {s.error || "No se pudo leer la Agenda local."}
          </Banner>
          <ErrorState onRetry={() => void store.hydrate()} />
        </>
      ) : (
        <FlatList
          ref={list}
          testID="agenda-day-list"
          key={s.day}
          data={store.list()}
          keyExtractor={(r) => r.id}
          initialNumToRender={initialOffset.y > 0 ? 32 : 12}
          maxToRenderPerBatch={12}
          windowSize={7}
          contentOffset={initialOffset}
          onContentSizeChange={restoreScroll}
          onScroll={(e) =>
            !restoration.current.busy &&
            store.rememberOffset(s.day, e.nativeEvent.contentOffset.y)
          }
          scrollEventThrottle={32}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 110 }}
          renderItem={({ item: r }) => (
            <View
              style={{ flexDirection: "row", gap: 12, paddingHorizontal: 16 }}
            >
              <Text
                kind="meta"
                style={{ width: 48, paddingTop: 4, color: c.text3 }}
              >
                {timeLabel(r.start)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${r.title}, ${timeLabel(r.start)}${r.cancelled ? ", cancelada" : ""}`}
                onPress={() => open(r)}
                style={{
                  flex: 1,
                  minHeight: 64,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderLeftWidth: 4,
                  borderColor:
                    r.kind === "block"
                      ? c.text3
                      : r.modality === "Meet"
                        ? c.info
                        : c.accent,
                  backgroundColor:
                    r.kind === "block"
                      ? c.sunken
                      : r.modality === "Meet"
                        ? c.tagBg
                        : c.wash,
                  marginBottom: 8,
                  opacity: r.cancelled ? 0.5 : r.kind === "block" ? 0.8 : 1,
                }}
              >
                <Text
                  weight="semibold"
                  style={{
                    fontSize: 14.5,
                    textDecorationLine: r.cancelled ? "line-through" : "none",
                  }}
                >
                  {r.title}
                </Text>
                <Text kind="capsule" style={{ color: c.text3 }}>
                  {r.who}
                  {r.modality ? ` · ${r.modality}` : ""}
                  {r.cancelled ? " · Cancelada" : ""}
                  {r.lab ? " · Prueba" : ""}
                </Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              title="Sin citas este día"
              message="Cuando alguien agende o la IA reserve, aparecerá aquí."
            />
          }
        />
      )}
      {s.ready && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bloquear horario"
          onPress={() => block()}
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

function DayStrip({
  days,
  selected,
  onSelect,
}: {
  days: readonly string[];
  selected: string;
  onSelect: (day: string) => void;
}) {
  const { colors: c } = useTheme();
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: 8,
          gap: 6,
        }}
      >
        {days.map((day) => {
          const d = dateParts(day),
            active = day === selected;
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityLabel={dayLabel(day)}
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(day)}
              style={{
                width: 50,
                minHeight: 64,
                paddingVertical: 8,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                borderWidth: 1,
                borderColor: active ? c.accent : c.border,
                backgroundColor: active ? c.accent : c.surface,
              }}
            >
              <Text
                kind="meta"
                style={{ color: active ? c.onAccent : c.text3 }}
              >
                {["D", "L", "M", "M", "J", "V", "S"][d.value.getUTCDay()]}
              </Text>
              <Text
                weight="semibold"
                style={{ fontSize: 17, color: active ? c.onAccent : c.text }}
              >
                {d.date}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Month({ store }: { store: AgendaStore }) {
  const s = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    { colors: c } = useTheme();
  const { year, month, value } = dateParts(s.day),
    title = value.toLocaleDateString("es-MX", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    });

  return (
    <>
      <AppBar
        title={
          title.charAt(0).toUpperCase() + title.slice(1).replace(" de ", " ")
        }
        onBack={() => store.configure({ view: "day" })}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        <View style={{ flexDirection: "row", gap: 2 }}>
          {["L", "M", "M", "J", "V", "S", "D"].map((v, i) => (
            <Text
              key={i}
              kind="meta"
              style={{
                flex: 1,
                textAlign: "center",
                color: c.text3,
                paddingVertical: 8,
              }}
            >
              {v}
            </Text>
          ))}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {calendarCells(year, month).map((day, i) => (
            <View key={i} style={{ width: "14.285714%", padding: 1 }}>
              {day ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={dayLabel(day)}
                  accessibilityState={{ selected: day === s.day }}
                  onPress={() => store.selectDay(day)}
                  style={{
                    minHeight: 48,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 3,
                    backgroundColor: day === s.day ? c.accent : "transparent",
                  }}
                >
                  <Text
                    weight={day === s.day ? "semibold" : "regular"}
                    style={{ color: day === s.day ? c.onAccent : c.text }}
                  >
                    {dateParts(day).date}
                  </Text>
                  <View
                    style={{
                      height: 5,
                      width: 5,
                      borderRadius: 3,
                      backgroundColor: store.hasAppointments(day)
                        ? day === s.day
                          ? c.onAccent
                          : c.accent
                        : "transparent",
                    }}
                  />
                </Pressable>
              ) : (
                <View style={{ height: 48 }} />
              )}
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

function BookingDetail({ store, id }: { store: AgendaStore; id: string }) {
  const s = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    r = store.get(id),
    directory = useContactDirectory(),
    layers = useLayers(),
    [error, setError] = useState("");
  const legacyLinks: Record<string, string> = {
    "demo-booking-b1": "demo-conv-2",
    "demo-booking-b2": "demo-conv-7",
    "demo-booking-b4": "demo-conv-1",
  };
  const contactId = r.contactId === undefined ? legacyLinks[r.id] : r.contactId;
  const contact =
    contactId && directory.workRepo.canRead(contactId)
      ? directory.conversations.get(directory.actor, contactId)
      : null;
  const cancel = async () => {
    try {
      await store.cancel(id, r.version);
      layers.close();
      layers.toast("Cita cancelada localmente");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Card>
        {[
          ["Cliente", r.who],
          ["Hora", `${timeLabel(r.start)} · ${r.duration} min`],
          ["Modalidad", r.modality || "—"],
          [
            "Enlace",
            r.modality === "Meet" || r.modality === "Zoom"
              ? "Unirse"
              : "Sin enlace",
          ],
          ["Notas", r.notes || "—"],
        ].map(([k, v]) => (
          <View
            key={k}
            style={{ flexDirection: "row", gap: 12, paddingVertical: 8 }}
          >
            <Text kind="secondary" style={{ flex: 1 }}>
              {k}
            </Text>
            {k === "Cliente" && contact ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Abrir contacto: ${contact.name}`}
                onPress={() => {
                  layers.close();
                  router.push(`/contact/${contact.id}`);
                }}
                style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
              >
                <Text kind="secondary" style={{ textAlign: "right" }}>
                  {contact.name}
                </Text>
              </Pressable>
            ) : k === "Enlace" && v === "Unirse" ? (
              <Button
                variant="ghost"
                onPress={() =>
                  layers.toast("Enlace ficticio · no se abre ningún proveedor")
                }
              >
                Unirse
              </Button>
            ) : (
              <Text kind="secondary" style={{ flex: 1, textAlign: "right" }}>
                {v}
              </Text>
            )}
          </View>
        ))}
      </Card>
      {r.cancelled ? (
        <Banner>Cita cancelada</Banner>
      ) : (
        <>
          <Button
            variant="secondary"
            disabled={s.saving}
            onPress={() =>
              layers.open({
                kind: "sheet",
                title: "Mover a",
                content: <MoveForm store={store} id={id} />,
              })
            }
          >
            Mover a…
          </Button>
          <Button
            variant="danger"
            loading={s.saving}
            onPress={() => void cancel()}
          >
            Cancelar cita
          </Button>
        </>
      )}
      {!!error && <Banner type="danger">{error}</Banner>}
    </>
  );
}

function BlockForm({
  store,
  initial,
}: {
  store: AgendaStore;
  initial?: Appointment;
}) {
  const s = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    layers = useLayers();
  const [day, setDay] = useState(initial?.day ?? s.day),
    [start, setStart] = useState(
      () =>
        initial?.start ??
        store.blockSlots(s.day, 60).find((t) => t >= 780) ??
        store.blockSlots(s.day, 60)[0] ??
        780,
    ),
    [duration, setDuration] = useState(initial?.duration ?? 60),
    [reason, setReason] = useState(initial?.title ?? ""),
    [expanded, setExpanded] = useState(""),
    [error, setError] = useState("");
  const days = weekDays(day);
  const times = store.blockSlots(day, duration, initial?.id),
    labels = times.map(timeLabel);
  const submit = async () => {
    try {
      await store.block(
        day,
        start,
        duration,
        reason,
        initial?.id,
        initial?.version,
      );
      layers.close();
      layers.toast(
        initial
          ? "Bloqueo actualizado localmente"
          : "Horario bloqueado localmente",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <PickerRow
        label="Día"
        value={dayLabel(day)}
        onPress={() => setExpanded(expanded === "day" ? "" : "day")}
      />
      {expanded === "day" && (
        <DayStrip
          days={days}
          selected={day}
          onSelect={(d) => {
            setDay(d);
            const free = store.blockSlots(d, duration, initial?.id);
            if (!free.includes(start)) setStart(free[0] ?? start);
            setExpanded("");
          }}
        />
      )}
      <PickerRow
        label="Hora"
        value={timeLabel(start)}
        onPress={() => setExpanded(expanded === "time" ? "" : "time")}
      />
      {expanded === "time" &&
        (labels.length ? (
          <FilterChips
            options={labels}
            value={timeLabel(start)}
            onChange={(label) => {
              setStart(times[labels.indexOf(label)]!);
              setExpanded("");
            }}
          />
        ) : (
          <Text>No quedan horarios libres este día.</Text>
        ))}
      <PickerRow
        label="Duración"
        value={
          duration === 30
            ? "30 min"
            : `${duration / 60} ${duration === 60 ? "hora" : "horas"}`
        }
        onPress={() => setExpanded(expanded === "duration" ? "" : "duration")}
      />
      {expanded === "duration" && (
        <FilterChips
          options={["30 min", "1 hora", "2 horas"]}
          value={
            duration === 30 ? "30 min" : duration === 60 ? "1 hora" : "2 horas"
          }
          onChange={(label) => {
            const minutes =
              label === "30 min" ? 30 : label === "1 hora" ? 60 : 120;
            setDuration(minutes);
            const free = store.blockSlots(day, minutes, initial?.id);
            if (!free.includes(start)) setStart(free[0] ?? start);
            setExpanded("");
          }}
        />
      )}
      <Field
        label="Motivo (opcional)"
        value={reason}
        maxLength={180}
        onChangeText={setReason}
        placeholder="Comida con proveedor"
      />
      {!!error && <Banner type="danger">{error}</Banner>}
      <Button variant="secondary" disabled={s.saving} onPress={layers.close}>
        Cancelar
      </Button>
      {!times.length && (
        <Banner type="warning">
          No quedan horarios libres este día. Elige otra fecha.
        </Banner>
      )}
      <Button
        loading={s.saving}
        disabled={!times.includes(start)}
        onPress={() => void submit()}
      >
        {initial ? "Guardar bloqueo" : "Bloquear"}
      </Button>
    </>
  );
}

function MoveForm({ store, id }: { store: AgendaStore; id: string }) {
  const s = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    r = store.get(id),
    directory = useContactDirectory(),
    layers = useLayers(),
    days = store.availableDays(id);
  const [day, setDay] = useState(days[0] ?? r.day),
    [start, setStart] = useState<number | null>(
      () =>
        store.available(id, days[0] ?? r.day)[1] ??
        store.available(id, days[0] ?? r.day)[0] ??
        null,
    ),
    [error, setError] = useState("");
  const [openedVersion] = useState(r.version);
  const times = store.available(id, day),
    labels = times.map(timeLabel);
  const move = async () => {
    if (start === null) return;
    try {
      await store.move(id, openedVersion, day, start);
      layers.close();
      layers.toast("Cita movida localmente");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Text kind="secondary">Días con huecos</Text>
      <DayStrip
        days={days}
        selected={day}
        onSelect={(d) => {
          setDay(d);
          setStart(store.available(id, d)[0] ?? null);
        }}
      />
      <Text kind="secondary">Horarios libres</Text>
      {labels.length ? (
        <FilterChips
          options={labels}
          value={start === null ? "" : timeLabel(start)}
          onChange={(label) => setStart(times[labels.indexOf(label)]!)}
        />
      ) : (
        <EmptyState title="Sin horarios libres" message="Elige otro día." />
      )}
      {!!error && <Banner type="danger">{error}</Banner>}
      <Button
        loading={s.saving}
        disabled={start === null || !times.includes(start)}
        onPress={() => void move()}
      >
        Confirmar
      </Button>
    </>
  );
}

function AgendaMenu({
  store,
  onBlock,
}: {
  store: AgendaStore;
  onBlock: () => void;
}) {
  const s = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  return (
    <>
      <Switch
        label="Mostrar canceladas"
        value={s.showCancelled}
        onChange={(showCancelled) => store.configure({ showCancelled })}
      />
      <Switch
        label="Mostrar pruebas del Laboratorio"
        value={s.showLab}
        onChange={(showLab) => store.configure({ showLab })}
      />
      {s.ready && (
        <NavRow icon={Lock} label="Bloquear horario" onPress={onBlock} />
      )}
    </>
  );
}
