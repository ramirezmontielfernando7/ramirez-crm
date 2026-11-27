export type LiveHint = {
  conversationId?: string;
  contactIds?: readonly string[];
};
export class StreamingUnavailable extends Error {}

const eventNames = new Set([
  "message.new",
  "message.status",
  "message.reaction",
  "conversation.updated",
  "assignment.changed",
  "participants.changed",
]);
const maxFrame = 512 * 1024;

// SSE is only an invalidation signal. No message text becomes UI or storage state.
export async function readEventHints(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onHint: (hint: LiveHint) => void,
  heartbeat: () => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let event = "";
  let data = "";
  const stop = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done || signal.aborted) break;
      heartbeat();
      pending += decoder.decode(chunk.value, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (!line) {
          if (eventNames.has(event) && data) {
            let payload: {
              conversationId?: unknown;
              conversation?: { id?: unknown };
              contactIds?: unknown;
            } | null = null;
            try {
              payload = JSON.parse(data);
            } catch {
              /* Refresh without a target. */
            }
            const id = payload?.conversationId ?? payload?.conversation?.id;
            onHint({
              conversationId: typeof id === "string" ? id : undefined,
              contactIds: Array.isArray(payload?.contactIds)
                ? payload.contactIds.filter(
                    (value): value is string => typeof value === "string",
                  )
                : undefined,
            });
          }
          event = "";
          data = "";
        } else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:") && eventNames.has(event))
          data += line.slice(5) + "\n";
        if (data.length > maxFrame) throw new Error("Invalid stream frame");
        newline = pending.indexOf("\n");
      }
      if (pending.length > maxFrame) throw new Error("Invalid stream frame");
    }
  } finally {
    signal.removeEventListener("abort", stop);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function liveDelay(attempt: number) {
  return Math.min(60_000, 5_000 * 2 ** Math.min(4, attempt));
}

export function waitForLive(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const timer = setTimeout(stop, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}

export async function maintainLiveUpdates(options: {
  signal: AbortSignal;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  onError: (error: unknown) => boolean;
  now?: () => number;
  wait?: typeof waitForLive;
}) {
  const {
    signal,
    connect,
    refresh,
    onError,
    now = Date.now,
    wait = waitForLive,
  } = options;
  let attempt = 0;
  let polling = false;
  while (!signal.aborted) {
    if (!polling) {
      const start = now();
      try {
        await connect();
      } catch (error) {
        if (signal.aborted || onError(error)) return;
        if (error instanceof StreamingUnavailable) polling = true;
      }
      if (now() - start >= 30_000) attempt = 0;
    }
    if (signal.aborted) return;
    await wait(polling ? 25_000 : liveDelay(attempt++), signal);
    if (!signal.aborted) await refresh();
  }
}
