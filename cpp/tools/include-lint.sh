#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$ROOT_DIR/cpp/build}"
CLANG_TIDY_BIN="${CLANG_TIDY_BIN:-clang-tidy-18}"

if ! command -v "$CLANG_TIDY_BIN" >/dev/null 2>&1; then
  CLANG_TIDY_BIN="clang-tidy"
fi

if [[ ! -f "$BUILD_DIR/compile_commands.json" ]]; then
  cmake -S "$ROOT_DIR/cpp" -B "$BUILD_DIR" >/dev/null
fi

mapfile -t SOURCES < <(rg --files "$ROOT_DIR/cpp/rs" "$ROOT_DIR/cpp/tools" "$ROOT_DIR/cpp/tests" -g'*.cpp' -g'*.c')

if [[ ${#SOURCES[@]} -eq 0 ]]; then
  echo "No C/C++ sources found."
  exit 0
fi

WARNINGS_AS_ERRORS=()
if [[ "${INCLUDE_LINT_STRICT:-0}" == "1" ]]; then
  WARNINGS_AS_ERRORS=(-warnings-as-errors='misc-include-cleaner')
fi

"$CLANG_TIDY_BIN" \
  -p "$BUILD_DIR" \
  -checks='-*,misc-include-cleaner,readability-duplicate-include' \
  "${WARNINGS_AS_ERRORS[@]}" \
  "${SOURCES[@]}"
