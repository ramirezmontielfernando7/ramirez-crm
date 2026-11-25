#!/usr/bin/env bash
set -euo pipefail
sdk=${ANDROID_HOME:?}/cmdline-tools/latest/bin/sdkmanager
test -x "$sdk"
set +o pipefail
yes | "$sdk" --licenses >/dev/null
status=${PIPESTATUS[1]}
set -o pipefail
test "$status" = 0
packages=('build-tools;37.0.0')
case "$1" in
  signing) ;;
  build) packages+=('platforms;android-37.0' 'build-tools;36.0.0' 'ndk;27.1.12297006' 'cmake;3.22.1') ;;
  *) exit 2 ;;
esac
"$sdk" "${packages[@]}"
