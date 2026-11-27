import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from "react-native";
import {
  ArrowDown,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
} from "lucide-react-native";
import { Button, EmptyState, Skeleton, Text } from "../components/ui";
import {
  chatPageSize,
  dayKey,
  dayLabel,
  followsSameSender,
  latestThreshold,
  timelineWindow,
  type ChatStyle,
} from "../integration/chat-timeline";
import type { WireMessage } from "../integration/wire";
import { useTheme } from "../theme/ThemeProvider";
import { RemoteAttachmentRow } from "./RemoteAttachments";
import type { RemotePageProps } from "./RemoteWorkspaceUi";

const statuses = {
  pending: ["Pendiente", Clock3],
  sent: ["Enviado", Check],
  delivered: ["Entregado", CheckCheck],
  read: ["Leído", CheckCheck],
  failed: ["Falló", CircleAlert],
} as const;
const hour = new Intl.DateTimeFormat("es-MX", {
  hour: "2-digit",
  minute: "2-digit",
});
const dashfortTime = new Intl.DateTimeFormat("es-MX", {
  hour: "2-digit",
  minute: "2-digit",
  day: "numeric",
  month: "short",
});
const rowKey = (row: WireMessage) => row.id;

const Bubble = memo(function Bubble({
  item,
  startsDay,
  grouped,
  appearance,
  repository,
  expired,
  jump,
  onAction,
}: RemotePageProps & {
  item: WireMessage;
  startsDay: boolean;
  grouped: boolean;
  appearance: ChatStyle;
  jump: (id: string) => void;
  onAction?: (item: WireMessage) => void;
}) {
  const { colors } = useTheme();
  const out = item.direction === "out";
  const chatStyle = appearance === "whatsapp";
  const sticker = Boolean(item.sticker && item.attachment);
  const color = sticker
    ? "transparent"
    : chatStyle
      ? out
        ? item.aiGenerated
          ? colors.bubbleAi
          : colors.bubbleTeam
        : colors.bubbleIn
      : out
        ? colors.wash
        : colors.sunken;
  const [label, Status] = statuses[item.status];
  const time = (chatStyle ? hour : dashfortTime).format(
    new Date(item.createdAt),
  );
  return (
    <View
      style={{ paddingTop: chatStyle && grouped ? 2 : 7, paddingBottom: 1 }}
    >
      {chatStyle && startsDay && (
        <View style={[styles.day, { backgroundColor: colors.surface }]}>
          <Text kind="meta">{dayLabel(item.createdAt)}</Text>
        </View>
      )}
      <Pressable
        onLongPress={onAction ? () => onAction(item) : undefined}
        delayLongPress={350}
        accessibilityHint={
          onAction ? "Mantén pulsado para responder o reaccionar" : undefined
        }
        accessibilityActions={
          onAction
            ? [{ name: "longpress", label: "Responder o reaccionar" }]
            : []
        }
        onAccessibilityAction={() => onAction?.(item)}
        style={{
          alignSelf: out ? "flex-end" : "flex-start",
          maxWidth: chatStyle ? "88%" : "86%",
        }}
      >
        {chatStyle && !grouped && !sticker && (
          <View
            style={[
              styles.tail,
              { backgroundColor: color },
              out ? { right: -3 } : { left: -3 },
            ]}
          />
        )}
        <View
          style={[
            styles.bubble,
            { backgroundColor: color },
            !chatStyle && { borderRadius: 16, padding: 10 },
            sticker && { padding: 0 },
            chatStyle &&
              !grouped &&
              (out ? { borderTopRightRadius: 4 } : { borderTopLeftRadius: 4 }),
          ]}
        >
          {!!item.sender && !grouped && (
            <Text weight="semibold" kind="meta">
              {item.sender}
            </Text>
          )}
          {item.quote && (
            <Button variant="ghost" onPress={() => jump(item.quote!.messageId)}>
              {item.quote.title + " · " + item.quote.preview}
            </Button>
          )}
          {item.attachment && (
            <RemoteAttachmentRow
              item={item.attachment}
              sticker={sticker}
              repository={repository}
              expired={expired}
            />
          )}
          {item.text ? (
            <Text>{item.text}</Text>
          ) : (
            !item.attachment && <Text>Mensaje sin texto</Text>
          )}
          <View
            style={styles.time}
            accessible
            accessibilityLabel={out ? time + " · " + label : time}
          >
            <Text kind="meta" style={{ color: colors.text3 }}>
              {time}
              {out && !chatStyle ? " · " + label : ""}
            </Text>
            {out && chatStyle && (
              <Status
                size={15}
                color={
                  item.status === "read"
                    ? colors.accent
                    : item.status === "failed"
                      ? colors.danger
                      : colors.text3
                }
              />
            )}
          </View>
        </View>
        {!!item.reactions?.length && (
          <View
            style={[
              styles.reactions,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {item.reactions.map(({ emoji, count, from }) => (
              <Text
                key={emoji + (from ?? "")}
                kind="meta"
                accessibilityLabel={
                  from
                    ? `${from === "in" ? "El cliente" : "El equipo"} reaccionó con ${emoji}`
                    : undefined
                }
              >
                {emoji}
                {count > 1 ? " " + count : ""}
                {from ? (from === "in" ? " Cliente" : " Equipo") : ""}
              </Text>
            ))}
          </View>
        )}
      </Pressable>
    </View>
  );
});

export function RemoteTimeline({
  messages,
  busy,
  refresh,
  older,
  appearance,
  repository,
  expired,
  onAction,
}: RemotePageProps & {
  messages: readonly WireMessage[];
  busy: boolean;
  refresh: () => void;
  older?: () => void;
  appearance: ChatStyle;
  onAction?: (item: WireMessage) => void;
}) {
  const { colors } = useTheme();
  const list = useRef<FlatList<WireMessage>>(null);
  const target = useRef<
    { id: string; failed: boolean; attempts: number } | undefined
  >(undefined);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [limit, setLimit] = useState(chatPageSize);
  const [pin, setPin] = useState<string>();
  const [notice, setNotice] = useState("");
  const previousHead = useRef<string | undefined>(undefined);
  const { rows, hidden } = useMemo(
    () => timelineWindow(messages, limit, pin),
    [messages, limit, pin],
  );
  const head = messages[0]?.id;
  useEffect(() => {
    if (!pin && !target.current && head && head !== previousHead.current)
      list.current?.scrollToOffset({ offset: 0, animated: false });
    previousHead.current = head;
  }, [head, pin]);
  const indexById = useMemo(
    () => new Map(rows.map((row, index) => [row.id, index])),
    [rows],
  );
  const visible = useRef(rows);
  visible.current = rows;
  const current = useRef(messages);
  current.current = messages;
  const tryJump = useCallback((index: number) => {
    const request = target.current;
    if (!request || !list.current) return;
    request.failed = false;
    request.attempts++;
    list.current.scrollToIndex({ index, viewPosition: 0.5, animated: false });
    if (!request.failed) target.current = undefined;
  }, []);
  const jump = useCallback(
    (id: string) => {
      const index = current.current.findIndex((row) => row.id === id);
      if (index < 0) {
        setNotice("El mensaje citado no está en el historial cargado.");
        return;
      }
      setNotice("");
      clearTimeout(retry.current);
      target.current = { id, failed: false, attempts: 0 };
      setPin(undefined);
      setLimit((size) => Math.max(size, index + 1));
      const mountedIndex = visible.current.findIndex((row) => row.id === id);
      if (mountedIndex >= 0) tryJump(mountedIndex);
    },
    [tryJump],
  );
  useEffect(() => {
    const request = target.current;
    if (!request || request.attempts) return;
    const index = indexById.get(request.id);
    if (index !== undefined) tryJump(index);
  }, [indexById, tryJump]);
  useEffect(() => () => clearTimeout(retry.current), []);
  const render = useCallback(
    ({ item, index }: ListRenderItemInfo<WireMessage>) => {
      const previous = messages[hidden + index + 1];
      return (
        <Bubble
          item={item}
          startsDay={
            !previous || dayKey(item.createdAt) !== dayKey(previous.createdAt)
          }
          grouped={followsSameSender(item, previous)}
          appearance={appearance}
          jump={jump}
          onAction={onAction}
          repository={repository}
          expired={expired}
        />
      );
    },
    [messages, hidden, appearance, jump, onAction, repository, expired],
  );
  const hasLocal = hidden + rows.length < messages.length;
  const loadOlder = useCallback(() => {
    if (!rows.length) return;
    if (hasLocal) setLimit((size) => size + chatPageSize);
    else older?.();
  }, [hasLocal, older, rows.length]);
  return (
    <View
      style={{
        flex: 1,
        backgroundColor:
          appearance === "whatsapp" ? colors.base : colors.surface,
      }}
    >
      {!!notice && (
        <Text kind="meta" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      )}
      <FlatList
        ref={list}
        inverted
        data={rows}
        keyExtractor={rowKey}
        renderItem={render}
        accessibilityLabel="Historial de mensajes"
        initialNumToRender={18}
        maxToRenderPerBatch={12}
        windowSize={7}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        onScroll={({ nativeEvent }) => {
          if (nativeEvent.contentOffset.y <= latestThreshold) setPin(undefined);
          else if (rows[0]) setPin((value) => value ?? rows[0]?.id);
        }}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.35}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          const request = target.current;
          if (!request) return;
          request.failed = true;
          list.current?.scrollToOffset({
            offset: index * averageItemLength,
            animated: false,
          });
          clearTimeout(retry.current);
          if (request.attempts >= 3) {
            target.current = undefined;
            return;
          }
          retry.current = setTimeout(() => {
            const next = visible.current.findIndex(
              (row) => row.id === request.id,
            );
            if (next >= 0 && target.current === request) tryJump(next);
          }, 120);
        }}
        onRefresh={refresh}
        refreshing={busy}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          busy ? <Skeleton rows={3} /> : <EmptyState title="Sin mensajes" />
        }
      />
      {!!hidden && (
        <View style={styles.latest}>
          <Button
            variant="secondary"
            icon={ArrowDown}
            onPress={() => {
              setPin(undefined);
              list.current?.scrollToOffset({ offset: 0, animated: false });
            }}
          >
            {`Ir al último · ${hidden}`}
          </Button>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { gap: 4, borderRadius: 14, padding: 8, minWidth: 76 },
  day: {
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    alignSelf: "center",
    marginBottom: 8,
  },
  tail: {
    width: 9,
    height: 9,
    top: 4,
    position: "absolute",
    transform: [{ rotate: "45deg" }],
  },
  content: { paddingHorizontal: 14, paddingVertical: 8 },
  time: {
    flexDirection: "row",
    gap: 3,
    alignItems: "center",
    alignSelf: "flex-end",
  },
  reactions: {
    flexDirection: "row",
    gap: 3,
    alignSelf: "flex-start",
    borderRadius: 15,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  latest: { position: "absolute", bottom: 9, right: 10 },
});
