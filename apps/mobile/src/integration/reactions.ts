import { RemoteHttpError } from "./remote-http";
import type { WireMessage } from "./wire";

/** The reaction the team already left on a message, if any. */
export function ownReaction(item: WireMessage): string | undefined {
  return item.reactions?.find((reaction) => reaction.from === "out")?.emoji;
}

export function reactionFailure(reason: unknown): {
  uncertain: boolean;
  message: string;
} {
  if (!(reason instanceof RemoteHttpError))
    return {
      uncertain: true,
      message:
        "No se pudo confirmar la reacción. Se actualizó el historial; revísalo antes de reintentar.",
    };
  const uncertain =
    reason.status === 0 ||
    reason.status >= 500 ||
    (reason.status === 409 && reason.code === "reaction_pending");
  return {
    uncertain,
    message: uncertain
      ? "No se pudo confirmar la reacción. Se actualizó el historial; revísalo antes de reintentar."
      : reason.message,
  };
}
