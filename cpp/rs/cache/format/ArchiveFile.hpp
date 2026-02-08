#pragma once

#include "../../core/Vec.hpp"
#include "../../types.hpp"

namespace rs {

class ArchiveFile {
public:
    ArchiveFile() = default;
    ArchiveFile(i32 id, i32 archiveId, Vec<u8> data, i32 nameHash = 0) : id(id), archiveId(archiveId), nameHash(nameHash), data(rs::move(data)) {}

    i32 id;
    i32 archiveId;
    i32 nameHash = 0;
    Vec<u8> data;
};

} // namespace rs
