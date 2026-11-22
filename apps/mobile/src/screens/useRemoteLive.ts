import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { maintainLiveUpdates, type LiveHint } from "../integration/remote-live";
import {
  requiresRemoteLogin,
  type RemoteAuthRepository,
  type RemoteHttpError,
} from "../integration/remote-http";

export function useRemoteLive(
  active: boolean,
  repo: RemoteAuthRepository,
  refresh: (signal: AbortSignal) => Promise<unknown> | void,
  expired: (reason: RemoteHttpError) => void,
  target?: { conversationId: string; contactId: string },
) {
  const callback = useRef({ refresh, expired });
  callback.current = { refresh, expired };
  const conversationId = target?.conversationId;
  const contactId = target?.contactId;

  useEffect(() => {
    if (!active) return;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let queued: AbortSignal | undefined;

    const refreshOnce = async (signal: AbortSignal) => {
      if (signal.aborted) return;
      if (busy) {
        queued = signal;
        return;
      }
      busy = true;
      queued = undefined;
      try {
        await callback.current.refresh(signal);
      } catch {
        // The view reports its own failure.
      } finally {
        busy = false;
        if (queued) void refreshOnce(queued);
      }
    };

    const stop = () => {
      controller?.abort();
      controller = undefined;
      clearTimeout(timer);
      timer = undefined;
      queued = undefined;
    };

    const start = (resume: boolean) => {
      if (controller) return;
      const { signal } = (controller = new AbortController());
      let firstConnection = true;
      function schedule(hint?: LiveHint) {
        if (signal.aborted || timer !== undefined) return;
        if (
          hint?.conversationId &&
          conversationId &&
          hint.conversationId !== conversationId
        )
          return;
        if (
          hint?.contactIds &&
          contactId &&
          !hint.contactIds.includes(contactId)
        )
          return;
        timer = setTimeout(() => {
          timer = undefined;
          void refreshOnce(signal);
        }, 750);
      }
      if (resume) void refreshOnce(signal);
      void maintainLiveUpdates({
        signal,
        connect: () =>
          repo.liveEvents(signal, schedule, () => {
            // Close the gap between the mount/resume snapshot and the first stream.
            if (firstConnection && !resume) schedule();
            firstConnection = false;
          }),
        refresh: () => refreshOnce(signal),
        onError(reason) {
          if (!requiresRemoteLogin(reason)) return false;
          callback.current.expired(reason);
          return true;
        },
      });
    };

    if (
      AppState.currentState !== "background" &&
      AppState.currentState !== "inactive"
    )
      start(false);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") start(true);
      else stop();
    });
    return () => {
      stop();
      subscription.remove();
    };
  }, [active, repo, conversationId, contactId]);
}
