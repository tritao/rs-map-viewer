#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-"$ROOT_DIR/build-wasm"}"
BUILD_TYPE="${BUILD_TYPE:-Release}"

mkdir -p "$BUILD_DIR"

emcmake cmake -S "$ROOT_DIR" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
cmake --build "$BUILD_DIR" -j

echo "Built wasm artifacts in: $BUILD_DIR"

