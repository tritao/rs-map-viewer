#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CPP_DIR="$ROOT_DIR/cpp"
BUILD_DIR="${BUILD_DIR:-"$CPP_DIR/build-wasm-map-render"}"
BUILD_TYPE="${BUILD_TYPE:-Release}"
OUT_DIR="${OUT_DIR:-"$ROOT_DIR/public/wasm"}"

mkdir -p "$BUILD_DIR"
mkdir -p "$OUT_DIR"

emcmake cmake -S "$CPP_DIR" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    -DRS_BUILD_WASM_MAP_RENDER_BACKEND=ON

cmake --build "$BUILD_DIR" --target rs_map_render_backend -j

cp "$BUILD_DIR/rs_map_render_backend.js" "$OUT_DIR/rs_map_render_backend.js"
cp "$BUILD_DIR/rs_map_render_backend.wasm" "$OUT_DIR/rs_map_render_backend.wasm"

echo "Built map-render wasm backend:"
echo "  $OUT_DIR/rs_map_render_backend.js"
echo "  $OUT_DIR/rs_map_render_backend.wasm"

