#include "Archive.hpp"

#include <algorithm>
#include <stdexcept>

#include "../../io/ByteSourceAccess.hpp"
#include "../../io/ByteSourceSlice.hpp"
#include "../../io/ByteSourceUtil.hpp"
#include "../../io/Endian.hpp"
#include "../../io/Uint8ArrayByteSource.hpp"

namespace rs {

Archive::Archive(i32 id, i32 lastFileId, std::vector<ArchiveFile> files)
    : id_(id), lastFileId_(lastFileId), files_(std::move(files)) {
    filesById_.assign(static_cast<std::size_t>(lastFileId_) + 1, nullptr);
    for (auto& f : files_) {
        if (f.id < 0) {
            continue;
        }
        const std::size_t idx = static_cast<std::size_t>(f.id);
        if (idx < filesById_.size()) {
            filesById_[idx] = &f;
        }
    }
}

const ArchiveFile* Archive::getFile(i32 id) const {
    if (id < 0) {
        return nullptr;
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx >= filesById_.size()) {
        return nullptr;
    }
    return filesById_[idx];
}

Archive Archive::decodeFromSource(const ArchiveMeta& meta, const ByteSource& source) {
    const i32 archiveId = meta.id;
    const i32 lastFileId = meta.lastFileId;
    const i32 fileCount = meta.fileCount;

    if (fileCount <= 0) {
        return Archive(archiveId, lastFileId, {});
    }

    if (fileCount == 1) {
        std::vector<u8> data = readAllBytes(source);
        std::vector<ArchiveFile> files;
        files.emplace_back(lastFileId, archiveId, std::move(data));
        return Archive(archiveId, lastFileId, std::move(files));
    }

    if (source.size() < 1) {
        throw std::runtime_error("Archive: empty source");
    }

    // Last byte is chunk count.
    u8 chunksU8 = 0;
    source.readInto(source.size() - 1, &chunksU8, 1);
    const i32 chunks = static_cast<i32>(chunksU8);
    if (chunks <= 0) {
        throw std::runtime_error("Archive: invalid chunk count");
    }

    const std::size_t tableBytes = static_cast<std::size_t>(chunks) * static_cast<std::size_t>(fileCount) * 4;
    if (tableBytes + 1 > source.size()) {
        throw std::runtime_error("Archive: invalid chunk table size");
    }
    const std::size_t tableOffset = source.size() - 1 - tableBytes;

    // Read chunk table into memory (small).
    std::vector<u8> table;
    table.resize(tableBytes);
    if (tableBytes) {
        source.readInto(tableOffset, table.data(), tableBytes);
    }

    // Parse sizes.
    std::vector<i32> chunkSizes;
    chunkSizes.assign(static_cast<std::size_t>(chunks) * static_cast<std::size_t>(fileCount), 0);
    std::vector<i32> fileSizes;
    fileSizes.assign(static_cast<std::size_t>(fileCount), 0);

    std::size_t tOff = 0;
    for (i32 chunk = 0; chunk < chunks; chunk++) {
        i32 lastChunkFileSize = 0;
        for (i32 fileIdx = 0; fileIdx < fileCount; fileIdx++) {
            if (tOff + 4 > table.size()) {
                throw std::runtime_error("Archive: truncated chunk table");
            }
            const i32 delta = readI32BE(table.data() + tOff);
            tOff += 4;
            lastChunkFileSize += delta;
            chunkSizes[static_cast<std::size_t>(chunk) * static_cast<std::size_t>(fileCount) +
                       static_cast<std::size_t>(fileIdx)] = lastChunkFileSize;
            fileSizes[static_cast<std::size_t>(fileIdx)] += lastChunkFileSize;
        }
    }

    std::vector<std::vector<u8>> fileData;
    fileData.resize(static_cast<std::size_t>(fileCount));
    std::vector<std::size_t> fileOffsets;
    fileOffsets.assign(static_cast<std::size_t>(fileCount), 0);

    for (i32 fileIdx = 0; fileIdx < fileCount; fileIdx++) {
        const std::size_t sz = static_cast<std::size_t>(fileSizes[static_cast<std::size_t>(fileIdx)]);
        fileData[static_cast<std::size_t>(fileIdx)].resize(sz);
    }

    // Payload is everything before tableOffset.
    std::size_t inputOffset = 0;
    for (i32 chunk = 0; chunk < chunks; chunk++) {
        for (i32 fileIdx = 0; fileIdx < fileCount; fileIdx++) {
            const i32 chunkSizeI32 =
                chunkSizes[static_cast<std::size_t>(chunk) * static_cast<std::size_t>(fileCount) +
                           static_cast<std::size_t>(fileIdx)];
            if (chunkSizeI32 < 0) {
                throw std::runtime_error("Archive: negative chunk size");
            }
            const std::size_t chunkSize = static_cast<std::size_t>(chunkSizeI32);

            const std::size_t dstOff = fileOffsets[static_cast<std::size_t>(fileIdx)];
            auto& dst = fileData[static_cast<std::size_t>(fileIdx)];
            if (dstOff + chunkSize > dst.size()) {
                throw std::runtime_error("Archive: chunk write out of bounds");
            }
            if (inputOffset + chunkSize > tableOffset) {
                throw std::runtime_error("Archive: payload read out of bounds");
            }
            if (chunkSize) {
                source.readInto(inputOffset, dst.data() + dstOff, chunkSize);
            }
            fileOffsets[static_cast<std::size_t>(fileIdx)] = dstOff + chunkSize;
            inputOffset += chunkSize;
        }
    }

    std::vector<ArchiveFile> files;
    files.reserve(static_cast<std::size_t>(fileCount));
    for (i32 fileIdx = 0; fileIdx < fileCount; fileIdx++) {
        const i32 fileId = meta.fileIds[static_cast<std::size_t>(fileIdx)];
        files.emplace_back(fileId, archiveId, std::move(fileData[static_cast<std::size_t>(fileIdx)]));
    }
    return Archive(archiveId, lastFileId, std::move(files));
}

} // namespace rs

