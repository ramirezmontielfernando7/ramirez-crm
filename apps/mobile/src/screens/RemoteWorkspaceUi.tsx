import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button, Text } from "../components/ui";
import {
  RemoteHttpError,
  requiresRemoteLogin,
  type RemoteAuthRepository,
} from "../integration/remote-http";

export type RemotePageProps = {
  repository: RemoteAuthRepository;
  expired: (error: RemoteHttpError) => void;
};
export function errorText(reason: unknown) {
  return reason instanceof RemoteHttpError
    ? reason.message
    : "No se pudo completar la solicitud.";
}

export function useRemoteData<T>(
  load: () => Promise<T>,
  expired: RemotePageProps["expired"],
) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setPending(true);
    setError("");
    try {
      const result = await load();
      if (generation.current !== request) return false;
      setData(result);
      return true;
    } catch (reason) {
      if (generation.current !== request) return false;
      setData(undefined);
      if (requiresRemoteLogin(reason)) expired(reason);
      else setError(errorText(reason));
      return false;
    } finally {
      if (generation.current === request) setPending(false);
    }
  }, [load, expired]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  return { data, error, pending, refresh };
}

export function RemoteFeedback({
  error,
  pending,
  refresh,
}: {
  error: string;
  pending: boolean;
  refresh: () => Promise<unknown>;
}) {
  return (
    <>
      {pending && <Text accessibilityLiveRegion="polite">Cargando…</Text>}
      {!!error && (
        <>
          <Banner type="warning">{error}</Banner>
          <Button variant="ghost" onPress={() => void refresh()}>
            Reintentar consulta
          </Button>
        </>
      )}
    </>
  );
}
