import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { LocalPort, LocalPermission } from "./local";
const channel = "dashfort-local-demo-v1";
async function permissions(request = false): Promise<LocalPermission> {
  if (Platform.OS !== "android") return "unsupported";
  await Notifications.setAutoServerRegistrationEnabledAsync(false);
  await Notifications.setNotificationChannelAsync(channel, {
    name: "Pruebas locales de Dashfort",
    description: "Muestras ficticias; sin mensajes reales",
    importance: Notifications.AndroidImportance.DEFAULT,
    enableVibrate: false,
    sound: null,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    showBadge: false,
  });
  const p = request
    ? await Notifications.requestPermissionsAsync()
    : await Notifications.getPermissionsAsync();
  const c = await Notifications.getNotificationChannelAsync(channel);
  if (p.granted && c?.importance === Notifications.AndroidImportance.NONE)
    return "channel-blocked";
  return p.granted
    ? "granted"
    : p.status === "undetermined"
      ? "undetermined"
      : "denied";
}
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
export const localPort: LocalPort = {
  permission: permissions,
  schedule: async (id, eventId, group, seconds) => {
    await Notifications.cancelScheduledNotificationAsync(id);
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title: "Dashfort",
        body: "Tienes un aviso nuevo en Dashfort",
        data: { transport: "dashfort-local-v1", eventId },
        threadIdentifier: group,
        autoDismiss: true,
        sticky: false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
        channelId: channel,
      },
    });
  },
  cancel: async (id) => {
    await Notifications.cancelScheduledNotificationAsync(id);
    await Notifications.dismissNotificationAsync(id);
  },
};
export async function observeLocalResponses(
  tap: (id: unknown) => Promise<unknown>,
) {
  let live = true;
  const handle = async (r: Notifications.NotificationResponse | null) => {
    if (
      !live ||
      !r ||
      r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
    )
      return;
    const d = r.notification.request.content.data;
    if (d?.transport !== "dashfort-local-v1") return;
    // Never trust routes/organization/message content from native data. The local journal is authoritative.
    await tap(d.eventId);
    if (live) await Notifications.clearLastNotificationResponseAsync();
  };
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    void handle(r).catch(() => {});
  });
  try {
    await handle(await Notifications.getLastNotificationResponseAsync());
  } catch {
    sub.remove();
    throw Error("No se pudo recuperar la apertura local.");
  }
  return () => {
    live = false;
    sub.remove();
  };
}
