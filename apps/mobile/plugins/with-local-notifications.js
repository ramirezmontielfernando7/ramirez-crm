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
    if (c.extra?.mobilePushFirebase === true) return c;
    app.service = [
      ...(app.service || []),
      ...[
        "expo.modules.notifications.service.ExpoFirebaseMessagingService",
        "com.google.firebase.messaging.FirebaseMessagingService",
      ].map((name) => ({
        $: { "android:name": name, "tools:node": "remove" },
      })),
    ];
    return c;
  });
