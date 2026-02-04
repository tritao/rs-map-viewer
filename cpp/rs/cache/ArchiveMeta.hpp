#pragma once

#include "../core/Span.hpp"
#include "../types.hpp"

namespace rs {

struct ArchiveMeta {
    i32 id = 0;
    i32 lastFileId = 0;
    i32 fileCount = 0;
    Span<const i32> fileIds;
    Span<const i32> fileNameHashes;
};

} // namespace rs

