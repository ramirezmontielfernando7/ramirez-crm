#!/usr/bin/env bash
# Encrypt the original bytes to an independently verified owner key already
# imported in the selected GnuPG keyring. Passwords stay in the owner's vault.
set +x
set -euo pipefail
umask 077
keystore=$1
recipient=$2
output=$3
[[ $recipient =~ ^[0-9A-F]{40}$ || $recipient =~ ^[0-9A-F]{64}$ ]]
test -f "$keystore" && test ! -e "$output"
temp="$(mktemp -d "$(dirname "$output")/.dashfort-backup-XXXXXX")"
trap 'rm -rf -- "$temp"' EXIT
python3 - "$keystore" <<'PY' | gpg --batch --no-tty --trust-model always --no-auto-key-retrieve   --auto-key-locate clear --recipient "$recipient" --output "$temp/keystore.tar.gpg" --encrypt 2>/dev/null
import sys
import tarfile

with open(sys.argv[1], "rb") as original, tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as archive:
    info = archive.gettarinfo(fileobj=original, arcname="dashfort-mobile.keystore")
    info.uid = info.gid = info.mtime = 0
    info.uname = info.gname = ""
    info.mode = 0o600
    archive.addfile(info, original)
PY
ln -- "$temp/keystore.tar.gpg" "$output"
sha256sum -- "$output"
