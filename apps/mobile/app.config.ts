import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const mode = process.env.EXPO_PUBLIC_MODE;
  const localPath = resolve(__dirname, "google-services.json");
  const configured =
    (mode === "production" || mode === "staging") && existsSync(localPath);
  if (mode === "production" && !configured) {
    throw new Error(
      "Dashfort producción requiere apps/mobile/google-services.json. Usa la configuración pública Android de Firebase para com.demfort.dashfort.dev.",
    );
  }
  if (configured) {
    const raw = readFileSync(localPath, "utf8");
    try {
      const data = JSON.parse(raw);
      if (
        data.type === "service_account" ||
        "private_key" in data ||
        !/^\d+$/.test(data.project_info?.project_number ?? "") ||
        !Array.isArray(data.client) ||
        !data.client.some(
          (item: {
            client_info?: { android_client_info?: { package_name?: string } };
          }) =>
            item.client_info?.android_client_info?.package_name ===
            "com.demfort.dashfort.dev",
        )
      )
        throw new Error("Invalid Firebase client");
    } catch {
      throw new Error(
        "google-services.json debe ser la configuración pública de Firebase para com.demfort.dashfort.dev.",
      );
    }
  }
  return {
    ...config,
    name: config.name ?? "Dashfort Dev",
    slug: config.slug ?? "dashfort-mobile-dev",
    android: {
      ...config.android,
      googleServicesFile: configured ? "./google-services.json" : undefined,
    },
    extra: { ...config.extra, mobilePushFirebase: configured },
  };
};
