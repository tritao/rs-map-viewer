#pragma once

#include <vector>

#include "../../types.hpp"

namespace rs {

struct ArchiveReference {
    i32 id = 0;
    i32 nameHash = 0;
    std::vector<u8> whirlpool; // 64 bytes when present
    i32 crc = 0;
    i32 revision = 0;
    i32 fileCount = 0;
    i32 lastFileId = 0;
    std::vector<i32> fileIds;
    std::vector<i32> fileNameHashes;
};

} // namespace rs

