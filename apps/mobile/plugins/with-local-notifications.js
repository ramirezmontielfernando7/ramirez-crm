// Local-only demo: no Firebase auto-init, messaging transport or APNs entitlement.
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
