import React, { useRef, useState } from "react";
import { View } from "react-native";
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
