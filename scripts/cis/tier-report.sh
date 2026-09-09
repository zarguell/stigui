#!/usr/bin/env bash
# Aggregate the bulk-conversion reports into shipping tiers:
#   tier1 = CLEAN conversions
#   tier2 = small findings (<= --max-findings, default 15)
#   tier3 = trouble children (more findings)
# Usage: bash tier-report.sh [max-findings]
set -euo pipefail
cd "$(dirname "$0")"

MAX=${1:-15}
REPORTS=../../data/cis/reports/catalog
TIERS=../../data/cis/reports
mkdir -p "$TIERS"
: > "$TIERS/tier1.txt"
: > "$TIERS/tier2.txt"
: > "$TIERS/tier3.txt"

for f in "$REPORTS"/*.txt; do
  base=$(basename "$f" .txt)
  findings=$(grep -c "^\s*- \[" "$f" || true)
  if grep -q "Result: CLEAN" "$f"; then
    echo "$base" >> "$TIERS/tier1.txt"
  elif [ "$findings" -le "$MAX" ]; then
    echo "$base | findings=$findings" >> "$TIERS/tier2.txt"
  else
    echo "$base | findings=$findings" >> "$TIERS/tier3.txt"
  fi
done

echo "tier1 (CLEAN):      $(wc -l < "$TIERS/tier1.txt")"
echo "tier2 (small gaps): $(wc -l < "$TIERS/tier2.txt")"
echo "tier3 (trouble):    $(wc -l < "$TIERS/tier3.txt")"
