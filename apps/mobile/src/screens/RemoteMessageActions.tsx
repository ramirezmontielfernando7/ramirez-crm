import React, { useRef, useState } from "react";
import { View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { Banner, Button, Text } from "../components/ui";
import {
  RemoteHttpError,
  requiresRemoteLogin,
} from "../integration/remote-http";
import { ownReaction, reactionFailure } from "../integration/reactions";
import type { WireMessage } from "../integration/wire";
import type { RemotePageProps } from "./RemoteWorkspaceUi";

export const reactionChoices = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
export const moreReactions = ["👏", "🔥", "🎉", "✅", "👀", "😍"] as const;

export function RemoteMessageActions({
  item,
  chatId,
  repository,
  expired,
  reply,
  refresh,
  close,
}: RemotePageProps & {
  item: WireMessage;
  chatId: string;
  reply: (item: WireMessage) => void;
  refresh: () => Promise<boolean>;
  close: () => void;
}) {
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const mine = ownReaction(item);

  async function react(emoji: string) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const result = await repository.reactToMessage(chatId, item.id, emoji);
      if (result === null) return;
      await refresh();
      close();
    } catch (reason) {
      if (requiresRemoteLogin(reason)) {
        expired(reason);
        return;
      }
      const failure = reactionFailure(reason);
      if (failure.uncertain) await refresh();
      setError(failure.message);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  return (
    <View style={{ gap: 8, padding: 12 }}>
      {repository.allowSend && (
        <Button
          variant="secondary"
          disabled={pending}
          onPress={() => {
            reply(item);
            close();
          }}
        >
          Responder
        </Button>
      )}
      {!!error && <Banner type="warning">{error}</Banner>}
      <Text kind="meta">Reaccionar</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {[...reactionChoices, ...(more ? moreReactions : [])].map((emoji) => (
          <Button
            key={emoji}
            variant={mine === emoji ? "primary" : "ghost"}
            disabled={pending}
            onPress={() => void react(emoji)}
          >
            {emoji}
          </Button>
        ))}
        {!more && (
          <Button
            variant="ghost"
            disabled={pending}
            onPress={() => setMore(true)}
          >
            Más
          </Button>
        )}
      </View>
      {mine !== undefined && (
        <Button
          variant="ghost"
          disabled={pending}
          onPress={() => void react("")}
        >
          Quitar mi reacción
        </Button>
      )}
    </View>
  );
}

export type ReplyQuote = { id: string; title: string; preview: string };

/** The quote shown above the composer; removing it sends a plain message. */
export function ReplyQuoteBar({
  quote,
  disabled,
  clear,
}: {
  quote: ReplyQuote;
  disabled: boolean;
  clear: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderLeftWidth: 3,
        borderColor: colors.accent,
        paddingLeft: 8,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text kind="meta" weight="semibold">
          {"Respondiendo a " + quote.title}
        </Text>
        <Text kind="meta" numberOfLines={2}>
          {quote.preview}
        </Text>
      </View>
      <Button variant="ghost" disabled={disabled} onPress={clear}>
        Quitar cita
      </Button>
    </View>
  );
}
