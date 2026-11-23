import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  conversationFromPush,
  type PushPort,
} from "../integration/remote-push";

const channel = "messages";

export const pushPort: PushPort = {
  available:
    Platform.OS === "android" &&
    Constants.expoConfig?.extra?.mobilePushFirebase === true,
  async permission(request) {
    await Notifications.setAutoServerRegistrationEnabledAsync(false);
    await Notifications.setNotificationChannelAsync(channel, {
      name: "Mensajes",
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    const permission = await Notifications.getPermissionsAsync();
    const result =
      request && permission.status === "undetermined" && permission.canAskAgain
        ? await Notifications.requestPermissionsAsync()
        : permission;
    return (
      result.granted &&
      (await Notifications.getNotificationChannelAsync(channel))?.importance !==
        Notifications.AndroidImportance.NONE
    );
  },
  async token() {
    const token = await Notifications.getDevicePushTokenAsync();
    if (token.type !== "android" || typeof token.data !== "string")
      throw new Error("Token Android no disponible.");
    return token.data;
  },
  onToken(received) {
    const subscription = Notifications.addPushTokenListener((token) => {
      if (token.type === "android" && typeof token.data === "string")
        received(token.data);
    });
    return () => subscription.remove();
  },
  onTap(received) {
    const accept = (response: Notifications.NotificationResponse | null) => {
      if (
        response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
      )
        return;
      const event = response.notification.request;
      const conversationId = conversationFromPush(event.content.data);
      if (!conversationId) return;
      received({ id: event.identifier, conversationId });
      Notifications.clearLastNotificationResponse();
    };
    const subscription =
      Notifications.addNotificationResponseReceivedListener(accept);
    try {
      accept(Notifications.getLastNotificationResponse());
    } catch {
      /* Another tap can still arrive. */
    }
    return () => subscription.remove();
  },
  async resetTaps() {
    Notifications.clearLastNotificationResponse();
    const displayed = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      displayed
        .filter((notice) => conversationFromPush(notice.request.content.data))
        .map((notice) =>
          Notifications.dismissNotificationAsync(notice.request.identifier),
        ),
    );
  },
};
