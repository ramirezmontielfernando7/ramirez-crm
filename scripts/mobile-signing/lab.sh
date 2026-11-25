#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077
scripts="$(dirname "$(realpath "$0")")"
temp="$(mktemp -d)"
trap 'rm -rf -- "$temp"' EXIT
export MOBILE_STORE_PASSWORD
MOBILE_STORE_PASSWORD="$(openssl rand -hex 32)"
export MOBILE_KEY_PASSWORD="$MOBILE_STORE_PASSWORD" MOBILE_KEY_ALIAS="dashfort-lab"
keytool -genkeypair -storetype PKCS12 -keystore "$temp/key.p12" \
  -alias "$MOBILE_KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 1 \
  -dname "CN=Dashfort Laboratory Disposable" -storepass:env MOBILE_STORE_PASSWORD >/dev/null 2>&1
fingerprint="$(keytool -exportcert -alias "$MOBILE_KEY_ALIAS" -keystore "$temp/key.p12" \
  -storepass:env MOBILE_STORE_PASSWORD | sha256sum | cut -d ' ' -f1)"
test "$fingerprint" != 0f5d018522f61cf6098871916d2c3cba8e0c6659427a7349c41f0225a983db1b
export MOBILE_KEYSTORE_B64
MOBILE_KEYSTORE_B64="$(base64 -w0 "$temp/key.p12")"
rm -- "$temp/key.p12"
bash "$scripts/sign.sh" "$1" "$2" "$3" "$4" "$fingerprint" "$temp/signed" "$6"
mkdir -m 700 "$5"
from="$(find "$temp/signed" -maxdepth 1 -name '*.apk' -type f)"
install -m 600 "$from" "$5/LAB-Dashfort-$3-ARM64.apk"
(cd "$5" && sha256sum "LAB-Dashfort-$3-ARM64.apk" > "LAB-Dashfort-$3-ARM64.apk.sha256")
printf 'Disposable certificate SHA-256: %s\n' "$fingerprint"
