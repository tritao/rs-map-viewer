#pragma once

#include <vector>

#include "../../types.hpp"

namespace rs {

class ArchiveFile {
public:
    ArchiveFile(i32 id, i32 archiveId, std::vector<u8> data) : id(id), archiveId(archiveId), data(std::move(data)) {}

    i32 id;
    i32 archiveId;
    std::vector<u8> data;
};

} // namespace rs

