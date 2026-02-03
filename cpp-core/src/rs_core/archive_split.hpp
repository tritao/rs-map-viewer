#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace rs_core {

// Splits a Jagex multi-file archive payload into per-file byte streams.
// This matches the logic used by `Archive.decodeFromSource` in the TS codebase.
std::vector<std::vector<uint8_t>> archive_split_payload(const std::vector<uint8_t>& payload, std::size_t file_count);

} // namespace rs_core

