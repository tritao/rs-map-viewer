#pragma once

#include "../../types.hpp"

namespace rs {

// Dat/Dat2 cache layout constants.
inline constexpr std::size_t IDX_ENTRY_SIZE = 6; // 3-byte length + 3-byte first-sector pointer

inline constexpr std::size_t SECTOR_HEADER_SIZE = 8;
inline constexpr std::size_t SECTOR_DATA_SIZE = 512;
inline constexpr std::size_t SECTOR_SIZE = SECTOR_HEADER_SIZE + SECTOR_DATA_SIZE; // 520

inline constexpr std::size_t SECTOR_EXTENDED_HEADER_SIZE = 10;
inline constexpr std::size_t SECTOR_EXTENDED_DATA_SIZE = 510;

} // namespace rs

