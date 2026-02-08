#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

# Convention: "decode*" helpers should not take Archive/CacheIndex/CacheSession directly.
# Those are edge/provider types and should be used in loaders/providers, not in pure decode.
#
# This is intentionally pattern-based (fast) rather than a full parser.
pattern='decode[A-Za-z0-9_]*\([^)]*\b(Archive|CacheIndex|CacheSession)\b[^)]*\)'

if rg -n "$pattern" cpp/rs --glob='*.hpp' --glob='*.cpp'; then
  echo
  echo "ERROR: decode-edge-check failed."
  echo "Decode helpers should take bytes/providers (Span<const u8>/ByteSource), not Archive/CacheIndex/CacheSession."
  exit 1
fi

echo "cpp decode-edge-check: ok"
