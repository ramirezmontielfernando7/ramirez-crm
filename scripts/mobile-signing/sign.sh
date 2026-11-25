#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

# The caller pins the certificate. The laboratory passes its one-use fingerprint.
unsigned=$1
approved_hash=$2
version=$3
version_code=$4
expected_certificate=$5
output=$6
tools=$7
verify="$(dirname "$(realpath "$0")")/verify.py"
temp="$(mktemp -d)"
trap 'rm -rf -- "$temp"' EXIT

# Strip caller variables from every native parser. Only apksigner sign receives
# the two passwords, and only after the input has independently passed checks.
store_password=${MOBILE_STORE_PASSWORD:?}
key_password=${MOBILE_KEY_PASSWORD:?}
key_alias=${MOBILE_KEY_ALIAS:?}
unset MOBILE_STORE_PASSWORD MOBILE_KEY_PASSWORD MOBILE_KEY_ALIAS
tool() { env -i PATH=/usr/bin:/bin HOME="$temp" "$@"; }

tool python3 "$verify" apk "$unsigned" "$approved_hash" "$version" "$version_code" "$tools/aapt"
tool "$tools/zipalign" -P 16 -f 4 "$unsigned" "$temp/aligned.apk" >/dev/null 2>&1
base64 --decode > "$temp/signing.keystore" <<< "${MOBILE_KEYSTORE_B64:?}"
unset MOBILE_KEYSTORE_B64

env -i PATH=/usr/bin:/bin HOME="$temp" MOBILE_STORE_PASSWORD="$store_password" \
  MOBILE_KEY_PASSWORD="$key_password" "$tools/apksigner" sign --ks "$temp/signing.keystore" --ks-key-alias "$key_alias" \
  --ks-pass env:MOBILE_STORE_PASSWORD --key-pass env:MOBILE_KEY_PASSWORD \
  --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true \
  --v4-signing-enabled false --out "$temp/signed.apk" "$temp/aligned.apk" >/dev/null 2>&1
unset store_password key_password key_alias
rm -- "$temp/signing.keystore"
tool "$tools/zipalign" -c -P 16 4 "$temp/signed.apk" >/dev/null 2>&1
signed_hash=$(sha256sum "$temp/signed.apk" | cut -d ' ' -f1)
tool python3 "$verify" apk "$temp/signed.apk" "$signed_hash" "$version" "$version_code" "$tools/aapt" --signed
tool python3 "$verify" cert "$tools/apksigner" "$temp/signed.apk" "$expected_certificate"
tool python3 "$verify" payload "$unsigned" "$temp/signed.apk"
mkdir -m 700 -- "$output"
filename=Dashfort-Mobile-"$version"-ARM64-signed.apk
install -m 600 -- "$temp/signed.apk" "$output/$filename"
printf '%s  %s\n' "$signed_hash" "$filename" > "$output/$filename.sha256"
