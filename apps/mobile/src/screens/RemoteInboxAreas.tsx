import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, FlatList, View } from "react-native";
import { AppBar } from "../components/ModuleUi";
import { Screen } from "../components/Screen";
import {
  Banner,
  Button,
  EmptyState,
  Field,
  ListRow,
  Text,
} from "../components/ui";
import { newestMessages, type ChatStyle } from "../integration/chat-timeline";
import {
  areaHistory,
  inboxHistoryPath,
  type AreaRow,
} from "../integration/remote-inbox-areas";
import {
  RemoteHttpError,
  requiresRemoteLogin,
} from "../integration/remote-http";
import type { WireMessage } from "../integration/wire";
import { RemoteTimeline } from "./RemoteTimeline";
import {
  errorText,
  RemoteFeedback,
  type RemotePageProps,
} from "./RemoteWorkspaceUi";

export function AreaList({
  rows,
  select,
  refresh,
  error,
  pending,
}: {
  rows: readonly AreaRow[];
  select: (row: AreaRow) => void;
  refresh: () => Promise<unknown>;
  error: string;
  pending: boolean;
}) {
  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      refreshing={pending}
      onRefresh={() => void refresh()}
      contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 114 }}
      renderItem={({ item }) => (
        <ListRow
          name={item.name}
          preview={
            item.supervised ? "Supervisión · solo lectura" : item.preview
          }
          unread={item.unread}
          onPress={() => select(item)}
        />
      )}
      ListEmptyComponent={
        error || pending ? (
          <RemoteFeedback error={error} pending={pending} refresh={refresh} />
        ) : (
          <EmptyState title="Sin conversaciones" />
        )
      }
    />
  );
}

export function AreaChat({
  repository,
  expired,
  area,
  row,
  appearance,
  back,
  lost,
}: RemotePageProps & {
  row: AreaRow;
  area: "team" | "number";
  appearance: ChatStyle;
  back: () => void;
  lost: () => void;
}) {
  const [messages, setMessages] = useState<readonly WireMessage[]>([]);
  const latest = useRef<readonly WireMessage[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [sending, setSending] = useState(false);
  const writing = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const oldest = useRef<string | undefined>(undefined);
  const more = useRef(false);
  const fail = useCallback(
    (reason: unknown) => {
      if (requiresRemoteLogin(reason)) expired(reason);
      else if (
        reason instanceof RemoteHttpError &&
        [403, 404].includes(reason.status)
      ) {
        latest.current = [];
        setMessages([]);
        setCanPost(false);
        lost();
        setError(errorText(reason));
      } else setError(errorText(reason));
    },
    [expired, lost],
  );

  const load = useCallback(
    async (previous = false) => {
      if (busy.current || (previous && !more.current)) return false;
      busy.current = true;
      const active = generation.current;
      const before = previous ? oldest.current : undefined;
      if (!previous) setPending(true);
      setError("");
      try {
        const response = areaHistory(
          await repository.read(inboxHistoryPath(area, row.id, before)),
          area,
          row.id,
        );
        if (generation.current !== active) return false;
        if (before || !oldest.current) {
          oldest.current = response.messages[0]?.id ?? oldest.current;
          more.current = response.more && !!response.messages.length;
        }
        const all = latest.current;
        latest.current = newestMessages(all, [...all, ...response.messages]);
        setMessages(latest.current);
        setCanPost(response.canPost);
        return true;
      } catch (reason) {
        if (generation.current === active) fail(reason);
        return false;
      } finally {
        busy.current = false;
        if (generation.current === active) setPending(false);
      }
    },
    [area, fail, repository, row.id],
  );

  useEffect(() => {
    void load();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => {
      generation.current++;
      subscription.remove();
    };
  }, [load]);

  async function send() {
    if (
      !draft.trim() ||
      !canPost ||
      !repository.allowSend ||
      writing.current ||
      uncertain
    )
      return;
    writing.current = true;
    setSending(true);
    setError("");
    const active = generation.current;
    try {
      const response =
        area === "number"
          ? await repository.sendNumberText(row.id, draft)
          : await repository.sendTeamText(row.id, draft);
      if (generation.current !== active || response === null) return;
      setDraft("");
      await load();
    } catch (reason) {
      if (generation.current !== active) return;
      if (
        !(reason instanceof RemoteHttpError) ||
        reason.status === 0 ||
        reason.status >= 500
      )
        setUncertain(true);
      if (
        reason instanceof RemoteHttpError &&
        reason.status === 403 &&
        !requiresRemoteLogin(reason)
      ) {
        setCanPost(false);
        setError(errorText(reason));
      } else fail(reason);
    } finally {
      writing.current = false;
      if (generation.current === active) setSending(false);
    }
  }
  return (
    <Screen>
      <AppBar title={row.name} onBack={back} />
      {!!error && (
        <View style={{ paddingHorizontal: 14 }}>
          <Banner type="warning">{error}</Banner>
          <Button variant="ghost" onPress={() => void load()}>
            Reintentar consulta
          </Button>
        </View>
      )}
      <RemoteTimeline
        messages={messages}
        busy={pending}
        refresh={() => {
          void load();
        }}
        older={() => {
          void load(true);
        }}
        repository={repository}
        expired={expired}
        appearance={appearance}
      />
      {repository.allowSend && canPost ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
          <Field
            label={
              area === "number"
                ? "Mensaje desde mi número"
                : "Mensaje para el equipo"
            }
            value={draft}
            onChangeText={setDraft}
            maxLength={area === "number" ? 4_096 : 20_000}
            multiline
            editable={!sending && !uncertain}
          />
          {uncertain ? (
            <>
              <Text kind="meta">
                Confirma en el historial si el mensaje llegó antes de volver a
                enviarlo.
              </Text>
              <Button
                onPress={async () => {
                  if (await load()) setUncertain(false);
                }}
              >
                Revisar historial
              </Button>
            </>
          ) : (
            <Button
              disabled={sending || !draft.trim()}
              onPress={() => void send()}
            >
              {sending
                ? "Enviando…"
                : area === "number"
                  ? "Enviar desde mi número"
                  : "Enviar al equipo"}
            </Button>
          )}
        </View>
      ) : (
        <Text kind="meta" style={{ padding: 12 }}>
          Solo lectura
        </Text>
      )}
    </Screen>
  );
}
