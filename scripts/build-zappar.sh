#!/usr/bin/env sh
# Rebuilds vendor/zappar-aframe/ from npm (@zappar/zappar-aframe, pinned in tools/zappar-build/package.json).
set -e
cd "$(dirname "$0")/../tools/zappar-build"
npm install --no-audit --no-fund
npm run build
# Face-tracking models are only fetched by face tracking, which SprayPath doesn't use.
rm -f ../../vendor/zappar-aframe/face_*.zbin
ls -la ../../vendor/zappar-aframe
