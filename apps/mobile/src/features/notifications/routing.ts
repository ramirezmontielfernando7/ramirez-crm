import type { Destination, Identity } from "./model";
import type { NotificationBackend, ProjectionPort } from "./ports";
export function checkDestination(
  d: Destination,
  i: Identity | null,
  now: number,
  backend: NotificationBackend,
  port: ProjectionPort,
) {
  if (d.expiresAt <= now) return "expired" as const;
  if (!i) return "needs-session" as const;
  if (d.organizationId !== i.organizationId)
    return "needs-organization" as const;
  try {
    backend.authorize(i, d.conversationId);
    const e = backend.known(i, d.eventId);
    if (
      e.expiresAt !== d.expiresAt ||
      e.expiresAt <= now ||
      e.conversationId !== d.conversationId ||
      e.organizationId !== d.organizationId ||
      !port.canOpen(i, d.conversationId)
    )
      return "denied" as const;
  } catch {
    return "denied" as const;
  }
  if (port.ready && !port.ready()) return "needs-navigation" as const;
  return "ready" as const;
}
