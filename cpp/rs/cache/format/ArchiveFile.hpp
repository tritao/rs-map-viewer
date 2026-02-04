#pragma once

#include "../../core/Vec.hpp"
#include "../../types.hpp"

namespace rs {

class ArchiveFile {
public:
    ArchiveFile() = default;
    ArchiveFile(i32 id, i32 archiveId, Vec<u8> data) : id(id), archiveId(archiveId), data(rs::move(data)) {}

    i32 id;
    i32 archiveId;
    Vec<u8> data;
};

} // namespace rs
