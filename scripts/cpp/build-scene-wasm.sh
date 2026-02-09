#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CPP_DIR="$ROOT_DIR/cpp"
BUILD_DIR="${BUILD_DIR:-"$CPP_DIR/build-wasm-scene"}"
BUILD_TYPE="${BUILD_TYPE:-Release}"
OUT_DIR="${OUT_DIR:-"$ROOT_DIR/public/wasm"}"

mkdir -p "$BUILD_DIR"
mkdir -p "$OUT_DIR"

emcmake cmake -S "$CPP_DIR" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    -DRS_BUILD_WASM_SCENE_BACKEND=ON

cmake --build "$BUILD_DIR" --target rs_scene_backend -j

cp "$BUILD_DIR/rs_scene_backend.js" "$OUT_DIR/rs_scene_backend.js"
cp "$BUILD_DIR/rs_scene_backend.wasm" "$OUT_DIR/rs_scene_backend.wasm"

echo "Built scene wasm backend:"
echo "  $OUT_DIR/rs_scene_backend.js"
echo "  $OUT_DIR/rs_scene_backend.wasm"
