import { eligible, type Event, type Permission } from "./model";
export const genericNotice = Object.freeze({
  title: "Dashfort" as const,
  body: "Tienes un aviso nuevo en Dashfort" as const,
});
export const fresh = (event: Event, now: number) =>
  event.expiresAt > now && event.occurredAt <= now + 60000;
export function shouldPresent(
  event: Event,
  permission: Permission,
  foreground: boolean,
  activeChat: string | null,
) {
  return (
    eligible(event) &&
    permission === "granted" &&
    (!foreground || activeChat !== event.conversationId)
  );
}
