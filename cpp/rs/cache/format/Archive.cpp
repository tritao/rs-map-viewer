#include "Archive.hpp"

#include <algorithm>
#include <stdexcept>

#include "../../io/ByteSourceAccess.hpp"
#include "../../io/ByteSourceSlice.hpp"
#include "../../io/ByteSourceUtil.hpp"
#include "../../io/Endian.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../io/Uint8ArrayByteSource.hpp"

namespace rs {

static bool looksLikeGzipWithTrailingU16(const std::vector<u8>& data) {
    if (data.size() < 10) {
        return false;
    }
    if (data[0] != 0x1F || data[1] != 0x8B) {
        return false;
    }
    const std::size_t len = data.size();
    const u32 isize = static_cast<u32>(data[len - 4]) | (static_cast<u32>(data[len - 3]) << 8) |
                      (static_cast<u32>(data[len - 2]) << 16) | (static_cast<u32>(data[len - 1]) << 24);
    return data[len - 2] == 0 && (isize & 0x00FF'FFFFu) == 0 && isize != 0;
}

static std::vector<u8> decompressDatGzip(const std::vector<u8>& data, const CompressionHandler& compressionHandler) {
    const bool canTrim = data.size() >= 2;
    const bool preferTrim = canTrim && looksLikeGzipWithTrailingU16(data);

    auto tryDecompress = [&](bool trim) -> std::vector<u8> {
        const std::size_t len = data.size();
        const std::size_t useLen = (trim && len >= 2) ? (len - 2) : len;
        return compressionHandler.decompressGzip(std::span<const u8>(data.data(), useLen));
    };

    try {
        return tryDecompress(preferTrim);
    } catch (...) {
        if (!canTrim) {
            throw;
        }
        return tryDecompress(!preferTrim);
    }
}

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

    std::vector<ArchiveFile> files;
    files.resize(static_cast<std::size_t>(fileCount));
    std::vector<std::size_t> fileOffsets(static_cast<std::size_t>(fileCount), 0);

    for (i32 fileIdx = 0; fileIdx < fileCount; fileIdx++) {
        const auto idx = static_cast<std::size_t>(fileIdx);
        files[idx].id = meta.fileIds[idx];
        files[idx].archiveId = archiveId;
        const std::size_t sz = static_cast<std::size_t>(fileSizes[idx]);
        files[idx].data.resize(sz);
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
            auto& dst = files[static_cast<std::size_t>(fileIdx)].data;
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

    return Archive(archiveId, lastFileId, std::move(files));
}

Archive Archive::create(i32 archiveId, std::vector<u8> data) {
    std::vector<ArchiveFile> files;
    files.emplace_back(0, archiveId, std::move(data));
    return Archive(archiveId, 0, std::move(files));
}

Archive Archive::decodeOld(i32 archiveId, const std::vector<u8>& data, bool multipleFiles, const CompressionHandler& compressionHandler) {
    if (!multipleFiles) {
        std::vector<u8> decompressed = decompressDatGzip(data, compressionHandler);
        std::vector<ArchiveFile> files;
        files.emplace_back(0, archiveId, std::move(decompressed));
        return Archive(archiveId, 0, std::move(files));
    }

    const std::span<const u8> input(data.data(), data.size());
    Uint8ArrayReader reader(input);

    const u32 actualSize = reader.readMedium();
    const u32 size = reader.readMedium();
    const bool isCompressed = actualSize != size;

    std::vector<u8> decompressed;
    Uint8ArrayReader metaReader(std::span<const u8>{});
    Uint8ArrayReader dataReader(std::span<const u8>{});

    if (isCompressed) {
        const std::span<const u8> compressedSpan = reader.readBytes(static_cast<std::size_t>(size));
        decompressed = compressionHandler.decompressBzip2(compressedSpan, static_cast<std::size_t>(actualSize));
        const std::span<const u8> decSpan(decompressed.data(), decompressed.size());
        metaReader = Uint8ArrayReader(decSpan);
        dataReader = Uint8ArrayReader(decSpan);
    } else {
        const std::size_t afterHeader = reader.tell();
        metaReader = Uint8ArrayReader(input, afterHeader);
        dataReader = Uint8ArrayReader(input, afterHeader);
    }

    const i32 fileCount = static_cast<i32>(metaReader.readUnsignedShort());
    if (fileCount <= 0) {
        return Archive(archiveId, -1, {});
    }

    const i32 lastFileId = fileCount - 1;

    // After the file table (10 bytes per file).
    const std::size_t tableStart = metaReader.tell();
    dataReader.seek(tableStart + static_cast<std::size_t>(fileCount) * 10);

    std::vector<ArchiveFile> files;
    files.reserve(static_cast<std::size_t>(fileCount));

    for (i32 i = 0; i < fileCount; i++) {
        (void)metaReader.readInt(); // nameHash (unused in the C++ model)
        const u32 fileActualSize = metaReader.readMedium();
        const u32 fileSize = metaReader.readMedium();

        std::vector<u8> fileData;
        if (isCompressed) {
            const std::span<const u8> fileSpan = dataReader.readBytes(static_cast<std::size_t>(fileSize));
            fileData.assign(fileSpan.begin(), fileSpan.end());
        } else {
            const std::span<const u8> compressedSpan = dataReader.readBytes(static_cast<std::size_t>(fileSize));
            fileData = compressionHandler.decompressBzip2(compressedSpan, static_cast<std::size_t>(fileActualSize));
        }

        files.emplace_back(i, archiveId, std::move(fileData));
    }

    return Archive(archiveId, lastFileId, std::move(files));
}

} // namespace rs
