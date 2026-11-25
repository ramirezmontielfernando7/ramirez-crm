#!/usr/bin/env bash
set -euo pipefail
umask 077
run=$1 artifact=$2 digest=$3 source=$4 version=$5 code=$6 profile=$7 mode=$8 output=$9
verify="$(dirname "$(realpath "$0")")/verify.py"
repo=ramirezmontielfernando7/ramirez-crm
[[ $run =~ ^[1-9][0-9]{0,18}$ && $artifact =~ ^[1-9][0-9]{0,18}$ && $digest =~ ^[0-9a-f]{64}$ ]]
# Check length, types and format before writing any value to GitHub summaries.
source_branch=codex/dashfort-mobile-request
[[ $mode != lab ]] || source_branch=codex/dashfort-mobile-c10-20261122
python3 "$verify" release "$source_branch" "$source" "$version" "$code" "$profile" "$mode"
mkdir -m 700 -- "$output"
gh api "repos/$repo/actions/runs/$run" > "$output/run.json"
gh api "repos/$repo/actions/artifacts/$artifact" > "$output/artifact.json"
archive_hash="$(python3 "$verify" run "$output/run.json" "$output/artifact.json" "$GITHUB_SHA" \
    "$run" "$artifact" "$source" "$version" "$code" "$profile" "$mode")"
gh api "repos/$repo/actions/artifacts/$artifact/zip" > "$output/artifact.zip"
python3 "$verify" unpack "$output/artifact.zip" "$archive_hash" "$output/unsigned.apk"
rm -- "$output/artifact.zip"
test "$(sha256sum "$output/unsigned.apk" | cut -d ' ' -f1)" = "$digest"
