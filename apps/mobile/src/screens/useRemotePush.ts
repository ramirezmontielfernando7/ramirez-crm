import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { PushRegistration, type PushTap } from "../integration/remote-push";
import {
  RemoteHttpError,
  requiresRemoteLogin,
  type RemoteAuthRepository,
  type RemoteSession,
} from "../integration/remote-http";
import { preferencesStorage } from "../services/storage";
import { pushPort } from "./remote-push-port";

type Preference = "on" | "off" | "pending-off";
export type RemotePushControls = {
  available: boolean;
  enabled: boolean;
  busy: boolean;
  denied: boolean;
  message: string;
  toggle(next: boolean): Promise<void>;
};

export function useRemotePush(
  repository: RemoteAuthRepository,
  session: RemoteSession | null,
  expired: (error: RemoteHttpError) => void,
) {
  const key = `dashfort.${repository.mode}.push.v1`;
  const [pref, setPref] = useState<Preference>();
  const desired = useRef<Preference | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [message, setMessage] = useState("");
  const [tap, setTap] = useState<PushTap>();
  const tapIds = useRef(new Set<string>());
  const active = useRef(session);
  active.current = session;
  const operation = useRef(false);
  const registration = useMemo(
    () =>
      new PushRegistration(pushPort, async (token, register) => {
        if (register && (!session || active.current !== session))
          throw new Error(
            "La sesión cambió antes de registrar el dispositivo.",
          );
        await repository.setPushDevice(token, register);
      }),
    [repository, session],
  );

  useEffect(() => {
    if (!pushPort.available) return;
    let mounted = true;
    void preferencesStorage
      .get(key)
      .then((value) => {
        if (mounted) {
          desired.current =
            value === "on" || value === "pending-off" ? value : "off";
          setPref(desired.current);
        }
      })
      .catch(() => {
        if (mounted) {
          desired.current = "off";
          setPref("off");
          setMessage("No se pudieron recuperar los ajustes de push.");
        }
      });
    return () => {
      mounted = false;
    };
  }, [key]);

  useEffect(() => {
    if (!pushPort.available) return;
    return pushPort.onTap((notice) => {
      if (tapIds.current.has(notice.id)) return;
      tapIds.current.add(notice.id);
      if (tapIds.current.size > 128)
        tapIds.current.delete(tapIds.current.values().next().value!);
      setTap(notice);
    });
  }, []);

  const remember = useCallback(
    async (value: Preference) => {
      await preferencesStorage.set(key, value);
      desired.current = value;
      setPref(value);
    },
    [key],
  );

  const fail = useCallback(
    (error: unknown) => {
      if (!session || active.current !== session) return;
      if (requiresRemoteLogin(error)) expired(error);
      else
        setMessage(
          error instanceof RemoteHttpError
            ? error.message
            : "No se pudo confirmar el estado de los avisos.",
        );
    },
    [expired, session],
  );

  useEffect(() => {
    if (!pushPort.available || !session || !pref || pref === "off") return;
    let mounted = true;
    async function sync() {
      if (operation.current || !mounted || active.current !== session) return;
      try {
        if (desired.current === "pending-off") {
          await registration.disable(true);
          if (!mounted || active.current !== session) return;
          await remember("off");
          setMessage("");
        } else if (desired.current === "on") {
          const allowed = await registration.sync(false);
          if (mounted && active.current === session) {
            setDenied(!allowed);
            setMessage(
              allowed
                ? ""
                : "Los avisos están desactivados en los ajustes de Android.",
            );
          }
        }
      } catch (error) {
        if (mounted) fail(error);
      }
    }
    const tokenSubscription = pushPort.onToken((token) => {
      if (!mounted || active.current !== session || desired.current !== "on")
        return;
      void registration.sync(false, token).catch((error) => {
        if (mounted) fail(error);
      });
    });
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    if (AppState.currentState === "active" || AppState.currentState === null)
      void sync();
    return () => {
      mounted = false;
      tokenSubscription();
      sub.remove();
    };
  }, [session, pref, registration, fail, remember]);

  async function toggle(value: boolean) {
    if (
      !pushPort.available ||
      !session ||
      operation.current ||
      active.current !== session ||
      !pref
    )
      return;
    operation.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (value) {
        const allowed = await registration.sync(true);
        if (active.current !== session) return;
        setDenied(!allowed);
        if (!allowed) {
          setMessage(
            "Los avisos están desactivados en los ajustes de Android.",
          );
          return;
        }
        try {
          await remember("on");
        } catch (error) {
          await registration.disable(false).catch(() => {});
          throw error;
        }
      } else {
        await remember("pending-off");
        await registration.disable(true);
        if (active.current !== session) return;
        await remember("off");
        setDenied(false);
      }
    } catch (error) {
      fail(error);
      if (!value && active.current === session && !requiresRemoteLogin(error))
        setMessage(
          "Falta desvincular el teléfono. Vuelve a intentarlo cuando haya conexión.",
        );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  const clearTap = useCallback((id: string) => {
    setTap((old) => (old?.id === id ? undefined : old));
  }, []);
  async function disconnect() {
    active.current = null;
    setTap(undefined);
    if (!pushPort.available) return;
    await Promise.allSettled([
      registration.disable(false),
      pushPort.resetTaps(),
    ]);
    registration.reset();
  }

  return {
    controls: {
      available: pushPort.available && pref !== undefined,
      enabled: pref === "on",
      busy,
      denied,
      message,
      toggle,
    },
    tap,
    clearTap,
    disconnect,
  };
}
