#!/usr/bin/env bash
set -euo pipefail
control="$(dirname "$(realpath "$0")")"
cd "${GITHUB_WORKSPACE:?}/source/apps/mobile"
test "$(git rev-parse HEAD)" = "$SOURCE_SHA"
test ! -e android
test "$(df --output=avail -B1 . | tail -1)" -ge 8589934592
# This is public Firebase client configuration, supplied out of band.
python3 - <<'PY'
import json
import os
from pathlib import Path

app = json.loads(Path("app.json").read_text())["expo"]
if (app["version"] != os.environ["VERSION_NAME"] or
    str(app["android"]["versionCode"]) != os.environ["VERSION_CODE"] or
    app["android"]["package"] != "com.demfort.dashfort.dev" or
    app.get("updates", {}).get("enabled") is not False):
    raise SystemExit("La configuración Expo difiere de la solicitud.")
if os.environ["EXPO_PUBLIC_MODE"] == "production":
    raw = os.environ.get("PUBLIC_FIREBASE_CLIENT", "")
    try:
        data = json.loads(raw)
        valid = (set(data) <= {"project_info", "client", "configuration_version"} and
                 "private_key" not in raw.lower() and "service_account" not in raw.lower() and
                 any(client["client_info"]["android_client_info"]["package_name"] == "com.demfort.dashfort.dev"
                     for client in data["client"]))
    except (ValueError, TypeError, AttributeError, KeyError):
        valid = False
    if not valid:
        raise SystemExit("Falta la configuración pública Firebase Android válida.")
    Path("google-services.json").write_text(raw)
PY
unset PUBLIC_FIREBASE_CLIENT
unset EXPO_PUBLIC_ALLOW_SEND
if [[ $EXPO_PUBLIC_MODE == production ]]; then
  export EXPO_PUBLIC_API_URL=https://dash.demfort.com
else
  unset EXPO_PUBLIC_API_URL
fi
bash "$control/sdk.sh" build
npm ci --no-audit --no-fund
npm run typecheck
npm run format:check
npm test
python3 scripts/verify-inventory.py
npx --no-install expo prebuild --platform android --no-install
python3 - <<'PY'
import re
from pathlib import Path
p = Path("android/app/build.gradle")
s = p.read_text()
start = s.index("        release {", s.index("    buildTypes {"))
end = s.index("\n        }", start)
release = s[start:end]
debug = "signingConfig signingConfigs.debug"
if release.count(debug) != 1:
    raise SystemExit("Cambió el Gradle generado. Revisar antes de compilar.")
p.write_text(s[:start] + release.replace(debug, "// CI: release intentionally unsigned") + s[end:])
p = Path("android/gradle.properties")
s = p.read_text()
for key in ("android.enableMinifyInReleaseBuilds", "android.enableShrinkResourcesInReleaseBuilds"):
    s = re.sub(r"^" + re.escape(key) + r"=.*\n?", "", s, flags=re.MULTILINE) + "\n" + key + "=true\n"
p.write_text(s)
PY
(cd android && ./gradlew :app:assembleRelease --no-daemon --max-workers=2 \
  -PreactNativeArchitectures=arm64-v8a -Dorg.gradle.jvmargs='-Xmx4g -XX:MaxMetaspaceSize=1g' \
  --init-script ../scripts/android-lean.gradle)
mkdir -m 700 "$RUNNER_TEMP/dashfort-build"
unsigned="$RUNNER_TEMP/dashfort-build/unsigned.apk"
install -m 600 android/app/build/outputs/apk/release/app-release-unsigned.apk "$unsigned"
hash=$(sha256sum "$unsigned" | cut -d ' ' -f1)
python3 "$control/verify.py" apk "$unsigned" "$hash" "$VERSION_NAME" "$VERSION_CODE" "$ANDROID_HOME/build-tools/37.0.0/aapt"
printf 'Commit `%s` · version %s (%s) · profile %s\n\nAPK SHA-256 `%s`\n' \
  "$SOURCE_SHA" "$VERSION_NAME" "$VERSION_CODE" "$EXPO_PUBLIC_MODE" "$hash" >> "$GITHUB_STEP_SUMMARY"
