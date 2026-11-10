#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Offline runtime APK. This script never calls EAS, GitHub Actions, adb, or a publishing service.
node -e 'const c=require("./app.json").expo; if(c.android.package!=="com.demfort.dashfort.dev" || c.updates.enabled!==false) process.exit(1)'
command -v java >/dev/null || { echo 'Falta JDK (usa JDK 17 para el toolchain Android).'; exit 2; }
command -v keytool >/dev/null || { echo 'Falta keytool del JDK.'; exit 2; }
mobile_sdk_path="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$mobile_sdk_path" || ! -d "$mobile_sdk_path/platforms/android-37" ]]; then
  echo 'APK no generada: falta Android SDK Platform 37. Consulta docs/APK-LOCAL.md.'
  exit 2
fi
if [[ ! -f android/gradlew ]]; then
  CI=1 EXPO_NO_TELEMETRY=1 npx expo prebuild --platform android --no-install
fi
# Expo's generated release must use its isolated debug signing config.
if ! grep -q 'signingConfig signingConfigs.debug' android/app/build.gradle; then
  echo 'La firma generada cambió. Revisa el proyecto nativo antes de compilar.'
  exit 3
fi
mkdir -p artifacts
# Generate a fresh experimental key; never look up or import existing production certificates.
if [[ ! -f artifacts/dashfort-experimental.keystore ]]; then
  keytool -genkeypair -keystore artifacts/dashfort-experimental.keystore -storepass android -keypass android -alias androiddebugkey -dname 'CN=Dashfort Experimental, O=Demo, C=MX' -keyalg RSA -keysize 2048 -validity 3650 -noprompt
fi
cp artifacts/dashfort-experimental.keystore android/app/debug.keystore
export EXPO_NO_TELEMETRY=1
# Gradle/SDK downloads may require Internet; the resulting APK bundles JS and fonts locally.
(cd android && ./gradlew :app:assembleRelease --no-daemon)
mobile_apk_path=android/app/build/outputs/apk/release/app-release.apk
test -s "$mobile_apk_path"
cp "$mobile_apk_path" artifacts/dashfort-mobile-tm1-experimental.apk
sha256sum artifacts/dashfort-mobile-tm1-experimental.apk
