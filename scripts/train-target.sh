#!/usr/bin/env sh
# Trains a mural photo into targets/<spot-id>.zpt for Zappar image tracking.
# Usage: ./scripts/train-target.sh photos/leake-street.jpg leake-street
# Then add  target: 'targets/leake-street.zpt'  to that spot in js/spots.js.
set -e
[ $# -eq 2 ] || { echo "Usage: $0 <photo.jpg|png> <spot-id>"; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PHOTO="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd "$ROOT/tools/zappar-build"
[ -d node_modules/@zappar/imagetraining ] || npm install --no-audit --no-fund
node train-target.mjs "$PHOTO" "$ROOT/targets/$2.zpt"
