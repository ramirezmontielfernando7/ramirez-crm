import React, {
  useEffect,
  useSyncExternalStore,
  useState,
  useRef,
} from "react";
import { View, Pressable } from "react-native";
import { router } from "expo-router";
import {
  Hand,
  ListChecks,
  CalendarDays,
  Gauge,
  Settings,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  NavRow,
  PageScroll,
  Section,
  Skeleton,
  Switch,
  Text,
} from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useTheme } from "../../theme/ThemeProvider";
import { useSession } from "../../state/SessionProvider";
import { useInbox, useInboxState } from "../inbox/store";
import { useContactDirectory } from "../contact/context";
import { useStudio } from "../studio/hooks";
import { StudioBar } from "../studio/StudioBar";
import { agendaFor } from "../agenda/state";
import { preferencesStorage } from "../../services/storage";
import type { InboxStore } from "../inbox/store-core";
import { NoticeStore, noticeRows } from "./core";
import { canAccess } from "../../domain/access";
const stores = new WeakMap<InboxStore, NoticeStore>();
export function noticesFor(inbox: InboxStore) {
  let s = stores.get(inbox);
  if (!s) {
    s = new NoticeStore(inbox.actor, "demo-org-cristal", preferencesStorage);
    stores.set(inbox, s);
  }
  return s;
}
function useNotices() {
  const inbox = useInbox(),
    store = noticesFor(inbox),
    state = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    );
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return { store, state };
}
export function NoticeSheet() {
  const { store, state } = useNotices(),
    inbox = useInbox(),
    dir = useContactDirectory(),
    work = dir.workRepo,
    agenda = agendaFor(inbox),
    studio = useStudio(),
    { close, toast } = useLayers(),
    { colors: c } = useTheme(),
    status = useInboxState().status;
  useSyncExternalStore(work.subscribe, work.snapshot, work.snapshot);
  useSyncExternalStore(agenda.subscribe, agenda.snapshot, agenda.snapshot);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    opening = useRef(false);
  useEffect(() => {
    void work.hydrate().then(() => work.fixtures());
    void agenda.hydrate();
    if (inbox.actor.role === "owner") void studio.store.library.hydrate();
  }, [work, agenda, studio.store, inbox.actor.role]);
  const rows = () =>
    noticeRows(
      store,
      inbox.repository,
      work,
      agenda,
      inbox.actor.role === "owner" ? studio.store : null,
    );
  if (!state.ready)
    return state.error ? (
      <ErrorState onRetry={() => void store.hydrate()} />
    ) : (
      <Skeleton rows={4} />
    );
  const values = rows();
  const icons = {
    handoff: Hand,
    task: ListChecks,
    appointment: CalendarDays,
    usage: Gauge,
  };
  const loading = !work.snapshot().ready || !agenda.snapshot().ready;
  const failed = work.snapshot().error || agenda.snapshot().error;
  const go = async (id: string) => {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setError("");
    try {
      if (!rows().some((r) => r.id === id))
        throw Error("El aviso ya no está disponible para tu perfil.");
      await store.markRead(id);
      const row = rows().find((r) => r.id === id);
      if (!row) throw Error("El aviso ya no está disponible para tu perfil.");
      close();
      router.push(row.target);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el aviso.");
    } finally {
      opening.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      {!!error && <Banner type="danger">{error}</Banner>}
      {status === "offline" && (
        <Banner type="warning">Sin conexión · avisos locales ficticios.</Banner>
      )}
      {status === "loading" || (loading && !failed) ? (
        <Skeleton rows={4} />
      ) : status === "error" || failed ? (
        <ErrorState
          onRetry={() => {
            void work.hydrate().then(() => work.fixtures());
            void agenda.hydrate();
            inbox.patch({ status: "normal" });
          }}
        />
      ) : status === "empty" || !values.length ? (
        <EmptyState
          title="No tienes avisos pendientes"
          message="Aquí verás tus traspasos, tareas, citas y consumo de demostración."
        />
      ) : (
        values.map((row) => {
          const Icon = icons[row.kind],
            read = state.doc.read.includes(row.id);
          return (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={`${row.title}${read ? ", leído" : ""}`}
              disabled={busy}
              onPress={() => void go(row.id)}
              style={{
                minHeight: 72,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderColor: c.border,
                flexDirection: "row",
                gap: 12,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 21,
                  backgroundColor: c.base,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon size={20} color={c.text3} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text weight={read ? "regular" : "medium"}>{row.title}</Text>
                <Text kind="meta">{row.subtitle}</Text>
              </View>
            </Pressable>
          );
        })
      )}
      <NavRow
        icon={Settings}
        label="Preferencias de avisos"
        onPress={() => {
          close();
          router.push("/notification-settings");
        }}
      />
    </>
  );
}
export function NotificationSettingsScreen() {
  const { session, disabled } = useSession();
  return (
    <Screen>
      {session && canAccess(session.role, "more", disabled) ? (
        <SettingsView />
      ) : (
        <EmptyState
          title="Acceso no permitido"
          message="Inicia una sesión ficticia para ver tus preferencias."
        />
      )}
    </Screen>
  );
}
function SettingsView() {
  const { store, state } = useNotices(),
    { toast } = useLayers(),
    [error, setError] = useState("");
  const change = (key: "sound" | "handoff" | "reminders", value: boolean) => {
    setError("");
    void store.preference(key, value).catch((e) => setError(e.message));
  };
  return (
    <>
      <StudioBar
        title="Notificaciones"
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)/more")
        }
      />
      <PageScroll>
        {!state.ready ? (
          state.error ? (
            <ErrorState onRetry={() => void store.hydrate()} />
          ) : (
            <Skeleton rows={4} />
          )
        ) : (
          <>
            {!!error && <Banner type="danger">{error}</Banner>}
            <Switch
              label="Sonido al recibir un mensaje"
              value={state.doc.preferences.sound}
              onChange={(v) => change("sound", v)}
            />
            <Switch
              label="Avisar cuando la IA pasa un chat"
              value={state.doc.preferences.handoff}
              onChange={(v) => change("handoff", v)}
            />
            <Switch
              label="Tareas y citas por vencer"
              value={state.doc.preferences.reminders}
              onChange={(v) => change("reminders", v)}
            />
            <Section>En el teléfono</Section>
            <Switch
              label="Notificaciones con la app cerrada (push)"
              value={false}
              onChange={() =>
                toast(
                  "Push remoto sigue desactivado. Las pruebas locales se realizan en el laboratorio.",
                )
              }
            />
            <Banner type="warning">
              Las notificaciones push remotas no están activadas. Tus
              preferencias se guardan solo en esta demostración. Los avisos
              locales del laboratorio permanecen sin sonido ni vibración.
            </Banner>
          </>
        )}
      </PageScroll>
    </>
  );
}
