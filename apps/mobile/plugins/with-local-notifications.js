// Keep Firebase auto-init off. Only configured Android builds include the FCM receiver.
const { withAndroidManifest } = require("expo/config-plugins");
module.exports = (config) =>
  withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application[0];
    const disabled = [
      "firebase_messaging_auto_init_enabled",
      "firebase_analytics_collection_enabled",
    ];
    app["meta-data"] = [
      ...(app["meta-data"] || []).filter(
        (x) => !disabled.includes(x.$["android:name"]),
      ),
      ...disabled.map((name) => ({
        $: {
          "android:name": name,
          "android:value": "false",
          "tools:replace": "android:value",
        },
      })),
    ];
    c.modResults.manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    const services = [
      "expo.modules.notifications.service.ExpoFirebaseMessagingService",
      "com.google.firebase.messaging.FirebaseMessagingService",
    ];
    // Prebuild may start from a manifest previously generated in demo mode.
    const entries = (app.service || []).filter(
      ({ $: attrs }) =>
        attrs["tools:node"] !== "remove" ||
        !services.includes(attrs["android:name"]),
    );
    app.service =
      c.extra?.mobilePushFirebase === true
        ? entries
        : [
            ...entries,
            ...services.map((name) => ({
              $: { "android:name": name, "tools:node": "remove" },
            })),
          ];
    return c;
  });
