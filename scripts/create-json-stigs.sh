#! /usr/bin/env bash

set -euo pipefail
shopt -s globstar

mkdir -p public/data/stigs/schema

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Convert into a staging dir so track_history can diff the incoming
# release against the current schema and precompute version deltas
# before anything is overwritten.
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

for file in data/stigs/**/*.xml; do
    JSON="$(yq --xml-strict-mode -p=xml -o=json <"$file")"
    ID=$(jq -r '.Benchmark.["+@id"]' <<<"$JSON")
    if [[ $ID == "null" ]]; then
        echo "No ID found in $file"
        continue
    fi
    jq . <<<"$JSON" >"$STAGING/$ID.json"
done

python3 "$SCRIPT_DIR/track_history.py" \
    --schema-dir public/data/stigs/schema \
    --data-dir public/data \
    --staged "$STAGING"

python3 "$SCRIPT_DIR/rebuild_manifest.py" \
    --schema-dir public/data/stigs/schema \
    --data-dir public/data
