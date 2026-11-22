import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLayers } from "../components/Layers";
import { Banner, Button, Card, PageScroll, Text } from "../components/ui";
import { requiresRemoteLogin } from "../integration/remote-http";
import type { WireConversation } from "../integration/wire";
import {
  errorText,
  RemoteFeedback,
  type RemotePageProps,
  useRemoteData,
} from "./RemoteWorkspaceUi";

export function RemoteAgents({ repository, expired }: RemotePageProps) {
  const load = useCallback(() => repository.agents(), [repository]);
  const result = useRemoteData(load, expired);
  return (
    <>
      <RemoteFeedback {...result} />
      {result.data?.length === 0 && <Text>Sin agentes en el negocio.</Text>}
      {result.data?.map((agent) => (
        <Card key={agent.id} style={{ gap: 6 }}>
          <Text weight="semibold">{agent.name}</Text>
          <Text kind="secondary">{agent.state}</Text>
        </Card>
      ))}
      <Text kind="meta">
        Editar agentes y conocimiento · Disponible en la versión web
      </Text>
      <Button
        variant="ghost"
        disabled={result.pending}
        onPress={() => void result.refresh()}
      >
        Actualizar agentes
      </Button>
    </>
  );
}

export function RemoteChatAI({
  repository,
  expired,
  chat,
  refresh,
}: RemotePageProps & {
  chat: WireConversation;
  refresh: () => Promise<boolean>;
}) {
  const { close } = useLayers();
  const [status, setStatus] = useState(chat);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const mode = status.handoffAt
    ? "Atención humana"
    : status.aiEnabled
      ? "IA activa en el chat"
      : "IA en pausa";
  const action = status.handoffAt
    ? "reactivate"
    : status.aiEnabled
      ? "pause"
      : "enable";
  async function change() {
    if (!confirm || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!(await repository.setConversationAI(chat.id, action))) return;
      await refresh();
      if (mounted.current) close();
    } catch (reason) {
      if (mounted.current) {
        if (requiresRemoteLogin(reason)) expired(reason);
        else {
          setError(errorText(reason));
          setConfirm(false);
          if ((await refresh()) && mounted.current)
            setStatus({ ...status, aiAvailable: false });
        }
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <PageScroll>
      <Text>{mode}</Text>
      {!!error && <Banner type="warning">{error}</Banner>}
      {repository.allowSend &&
        status.aiAvailable &&
        !chat.isGroup &&
        (confirm ? (
          <>
            <Banner>
              {action === "pause"
                ? "La IA dejará de responder en este chat."
                : "La IA podrá responder en este chat."}
            </Banner>
            <Button loading={busy} onPress={() => void change()}>
              Confirmar cambio de IA
            </Button>
          </>
        ) : (
          <Button onPress={() => setConfirm(true)}>
            {action === "pause" ? "Pausar IA" : "Reactivar IA"}
          </Button>
        ))}
    </PageScroll>
  );
}

export function RemoteWritingAssist({
  repository,
  expired,
  draft,
  apply,
}: RemotePageProps & { draft: string; apply: (text: string) => void }) {
  const { close } = useLayers();
  const load = useCallback(() => repository.writingAvailable(), [repository]);
  const availability = useRemoteData(load, expired);
  const [suggestion, setSuggestion] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function suggest() {
    if (lock.current || !availability.data) return;
    lock.current = true;
    setError("");
    setBusy(true);
    try {
      const text = await repository.suggestDraft(draft);
      if (text && mounted.current) setSuggestion(text);
    } catch (reason) {
      if (!mounted.current) return;
      if (requiresRemoteLogin(reason)) expired(reason);
      else setError(errorText(reason));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <PageScroll>
      <RemoteFeedback {...availability} />
      {availability.data === false && (
        <Text>El asistente de redacción no está disponible.</Text>
      )}
      {!!error && <Banner type="warning">{error}</Banner>}
      {!!availability.data && (
        <>
          <Text kind="secondary">
            Solo se comparte con el asistente el texto de este borrador.
          </Text>
          {suggestion ? (
            <View style={{ gap: 8 }}>
              <Card>
                <Text>{suggestion}</Text>
              </Card>
              <Button
                onPress={() => {
                  apply(suggestion);
                  close();
                }}
              >
                Usar como borrador
              </Button>
            </View>
          ) : (
            <Button loading={busy} onPress={() => void suggest()}>
              Pedir sugerencia
            </Button>
          )}
        </>
      )}
    </PageScroll>
  );
}
