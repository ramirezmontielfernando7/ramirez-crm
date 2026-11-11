#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Compilación local aislada. No invoca EAS, Actions, adb ni publicación.
mobile_apk_output="${MOBILE_APK_OUTPUT:-artifacts/dashfort-mobile-experimental.apk}"
if [[ -e "$mobile_apk_output" || -e "$mobile_apk_output.sha256" ]]; then
  echo 'Salida existente: se conserva. Indica MOBILE_APK_OUTPUT con una ruta nueva.'
  exit 4
fi
node -e 'const c=require("./app.json").expo; if(c.android.package!=="com.demfort.dashfort.dev" || c.updates.enabled!==false) process.exit(1)'
for mobile_tool in java javac jlink keytool; do
  command -v "$mobile_tool" >/dev/null || { echo "Falta $mobile_tool: usa un JDK 17 completo."; exit 2; }
done
mobile_sdk_path="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$mobile_sdk_path" ]] || { [[ ! -f "$mobile_sdk_path/platforms/android-37.0/android.jar" ]] && [[ ! -f "$mobile_sdk_path/platforms/android-37/android.jar" ]]; }; then
  echo 'Falta SDK Platform 37: instala platforms;android-37.0. Consulta docs/APK-LOCAL.md.'
  exit 2
fi
for mobile_tool in aapt apksigner zipalign; do
  test -x "$mobile_sdk_path/build-tools/37.0.0/$mobile_tool" || { echo "Falta Build Tools 37.0.0 ($mobile_tool)."; exit 2; }
done
mobile_inputs_hash="$(node -e 'const f=require("fs"),c=require("crypto").createHash("sha256"); for(const p of ["app.json","app.config.ts","app.config.js","package-lock.json"]) if(f.existsSync(p))c.update(p).update(f.readFileSync(p)); console.log(c.digest("hex"))')"
if [[ -f android/gradlew ]]; then
  if [[ ! -f android/.dashfort-inputs.sha256 || "$(cat android/.dashfort-inputs.sha256)" != "$mobile_inputs_hash" ]]; then
    echo 'Proyecto Android existente sin configuración coincidente. Usa una copia limpia; no se sobrescribe.'
    exit 3
  fi
else
  CI=1 EXPO_NO_TELEMETRY=1 npx expo prebuild --platform android --no-install
  printf '%s\n' "$mobile_inputs_hash" > android/.dashfort-inputs.sha256
fi
grep -q 'signingConfig signingConfigs.debug' android/app/build.gradle || { echo 'Firma nativa inesperada. Revisa el proyecto generado.'; exit 3; }
mkdir -p artifacts
mobile_signing_key="${MOBILE_SIGNING_KEY:-artifacts/dashfort-experimental.keystore}"
if [[ ! -f "$mobile_signing_key" ]]; then
  if [[ -n "${MOBILE_SIGNING_KEY:-}" ]]; then echo 'No existe la firma experimental indicada.'; exit 3; fi
  keytool -genkeypair -keystore "$mobile_signing_key" -storepass android -keypass android -alias androiddebugkey -dname 'CN=Dashfort Experimental, O=Demo, C=MX' -keyalg RSA -keysize 2048 -validity 3650 -noprompt
fi
# Solo claves experimentales con la configuración de firma de desarrollo de Expo.
cp "$mobile_signing_key" android/app/debug.keystore
mobile_gradle_args=(:app:assembleRelease --no-daemon --max-workers=1 "-PreactNativeArchitectures=${MOBILE_ANDROID_ABIS:-arm64-v8a}")
if [[ "${MOBILE_ANDROID_LEAN:-0}" == 1 ]]; then mobile_gradle_args+=(--init-script ../scripts/android-lean.gradle); fi
export EXPO_NO_TELEMETRY=1
(cd android && ./gradlew "${mobile_gradle_args[@]}")
mobile_built_apk=android/app/build/outputs/apk/release/app-release.apk
test -s "$mobile_built_apk"
mobile_badging="$("$mobile_sdk_path/build-tools/37.0.0/aapt" dump badging "$mobile_built_apk")"
[[ "$mobile_badging" == *"package: name='com.demfort.dashfort.dev'"* ]]
"$mobile_sdk_path/build-tools/37.0.0/apksigner" verify "$mobile_built_apk"
"$mobile_sdk_path/build-tools/37.0.0/zipalign" -c -P 16 4 "$mobile_built_apk"
mkdir -p "$(dirname "$mobile_apk_output")"
# No reemplazar una salida que aparezca mientras compila.
(set -o noclobber; cat "$mobile_built_apk" > "$mobile_apk_output")
(set -o noclobber; sha256sum "$mobile_apk_output" > "$mobile_apk_output.sha256")
cat "$mobile_apk_output.sha256"
