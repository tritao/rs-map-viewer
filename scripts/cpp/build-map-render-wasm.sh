#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CPP_DIR="$ROOT_DIR/cpp"
BUILD_DIR="${BUILD_DIR:-"$CPP_DIR/build-wasm-map-render"}"
BUILD_TYPE="${BUILD_TYPE:-Release}"
OUT_DIR="${OUT_DIR:-"$ROOT_DIR/src/wasm"}"
EXPORT_PROFILE="${EXPORT_PROFILE:-prod}"
OUT_BASENAME="${OUT_BASENAME:-rs_map_runtime}"

if [[ "$EXPORT_PROFILE" != "prod" && "$EXPORT_PROFILE" != "debug" ]]; then
    echo "Invalid EXPORT_PROFILE=$EXPORT_PROFILE (expected prod|debug)" >&2
    exit 1
fi

if [[ "$EXPORT_PROFILE" == "debug" && "${OUT_BASENAME}" == "rs_map_runtime" ]]; then
    OUT_BASENAME="rs_map_runtime_debug"
fi

mkdir -p "$BUILD_DIR"
mkdir -p "$OUT_DIR"

# Keep the emscripten cache under the build dir so sandboxed environments don't try to
# write into a global emsdk cache location.
export EM_CACHE="${EM_CACHE:-"$BUILD_DIR/.emcache"}"
mkdir -p "$EM_CACHE"

emcmake cmake -S "$CPP_DIR" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    -DRS_BUILD_WASM_MAP_RENDER_BACKEND=ON \
    -DRS_MAP_RENDER_WASM_DEBUG_EXPORTS="$([[ "$EXPORT_PROFILE" == "debug" ]] && echo ON || echo OFF)"

cmake --build "$BUILD_DIR" --target rs_map_render_backend -j

cp "$BUILD_DIR/rs_map_render_backend.js" "$OUT_DIR/${OUT_BASENAME}.js"
cp "$BUILD_DIR/rs_map_render_backend.wasm" "$OUT_DIR/${OUT_BASENAME}.wasm"

echo "Built map-render wasm backend (profile=$EXPORT_PROFILE):"
echo "  $OUT_DIR/${OUT_BASENAME}.js"
echo "  $OUT_DIR/${OUT_BASENAME}.wasm"
