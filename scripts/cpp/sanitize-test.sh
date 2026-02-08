#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

cmake -S cpp -B cpp/build-sanitize -DCMAKE_BUILD_TYPE=RelWithDebInfo -DRS_ENABLE_SANITIZERS=ON
cmake --build cpp/build-sanitize -j

# Note: LeakSanitizer may fail under ptrace restrictions (e.g. kernel.yama.ptrace_scope=1) in some environments.
# Keep leak detection off by default; opt-in with RS_SANITIZE_LEAKS=1.
detect_leaks=0
if [[ "${RS_SANITIZE_LEAKS:-0}" == "1" ]]; then
  detect_leaks=1
  if [[ -r /proc/sys/kernel/yama/ptrace_scope ]]; then
    ptrace_scope="$(cat /proc/sys/kernel/yama/ptrace_scope || true)"
    if [[ "${ptrace_scope}" != "0" ]]; then
      echo "WARN: RS_SANITIZE_LEAKS=1 but kernel.yama.ptrace_scope=${ptrace_scope} may prevent LeakSanitizer from running."
    fi
  fi
fi

ASAN_OPTIONS="detect_leaks=${detect_leaks}:abort_on_error=1" UBSAN_OPTIONS=halt_on_error=1 ctest --test-dir cpp/build-sanitize --output-on-failure
