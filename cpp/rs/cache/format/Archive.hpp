#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "../../io/ByteSource.hpp"
#include "../../compression/CompressionHandler.hpp"
#include "../../types.hpp"
#include "ArchiveFile.hpp"

namespace rs {

struct ArchiveMeta {
    i32 id = 0;
    i32 lastFileId = 0;
    i32 fileCount = 0;
    std::vector<i32> fileIds;
    std::vector<i32> fileNameHashes;
};

class Archive {
public:
    static Archive decodeFromSource(const ArchiveMeta& meta, const ByteSource& source);
    static Archive decodeOld(i32 archiveId, const std::vector<u8>& data, bool multipleFiles, const CompressionHandler& compressionHandler);
    static Archive create(i32 archiveId, std::vector<u8> data);

    Archive(i32 id, i32 lastFileId, std::vector<ArchiveFile> files);

    [[nodiscard]] const std::vector<ArchiveFile>& files() const { return files_; }
    [[nodiscard]] const ArchiveFile* getFile(i32 id) const;

private:
    i32 id_;
    i32 lastFileId_;
    std::vector<ArchiveFile> files_;
    std::vector<const ArchiveFile*> filesById_;
};

} // namespace rs
