#include "Archive.hpp"
#include "ArchiveFile.hpp"

#include <cstddef>

#include "../../cache/ArchiveMeta.hpp"
#include "../../compression/CompressionHandler.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Result.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/ByteSource.hpp"
#include "../../io/ByteSourceUtil.hpp"
#include "../../io/Endian.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"

namespace rs {

static bool looksLikeGzipWithTrailingU16(Span<const u8> data) noexcept {
    if (data.size() < 10) {
        return false;
    }
    if (data[0] != 0x1F || data[1] != 0x8B) {
        return false;
    }
    const std::size_t len = data.size();
    const u32 isize = readU32LE(data.data() + (len - 4));
    return data[len - 2] == 0 && (isize & 0x00FF'FFFFu) == 0 && isize != 0;
}

static Result<Vec<u8>> decompressDatGzip(Span<const u8> data, const CompressionHandler& compressionHandler, Allocator& alloc) noexcept {
    const bool canTrim = data.size() >= 2;
    const bool preferTrim = canTrim && looksLikeGzipWithTrailingU16(data);

    auto tryDecompress = [&](bool trim) noexcept -> Result<Vec<u8>> {
        const std::size_t len = data.size();
        const std::size_t useLen = (trim && len >= 2) ? (len - 2) : len;
        return compressionHandler.decompressGzip(data.subspan(0, useLen), alloc);
    };

    Result<Vec<u8>> r = tryDecompress(preferTrim);
    if (r.isOk()) {
        return r;
    }
    if (!canTrim) {
        return r;
    }
    return tryDecompress(!preferTrim);
}

Archive::Archive(i32 id, i32 lastFileId, Vec<ArchiveFile> files, Allocator& alloc) noexcept
    : id_(id), lastFileId_(lastFileId), files_(rs::move(files)), filesById_(alloc) {
    if (lastFileId_ < 0) {
        lastFileId_ = -1;
    }

    const std::size_t byIdSize = static_cast<std::size_t>(lastFileId_ + 1);
    (void)filesById_.resize(byIdSize);
    for (std::size_t i = 0; i < filesById_.size(); i++) {
        filesById_[i] = nullptr;
    }

    for (std::size_t i = 0; i < files_.size(); i++) {
        ArchiveFile& f = files_[i];
        if (f.id < 0) {
            continue;
        }
        const std::size_t idx = static_cast<std::size_t>(f.id);
        if (idx < filesById_.size()) {
            filesById_[idx] = &f;
        }
    }
}

const ArchiveFile* Archive::getFile(i32 id) const noexcept {
    if (id < 0) {
        return nullptr;
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx >= filesById_.size()) {
        return nullptr;
    }
    return filesById_[idx];
}

const ArchiveFile* Archive::getFileByNameHash(i32 nameHash) const noexcept {
    for (std::size_t i = 0; i < files_.size(); i++) {
        const ArchiveFile& f = files_[i];
        if (f.nameHash == nameHash) {
            return &f;
        }
    }
    return nullptr;
}

i32 Archive::getFileIdByNameHash(i32 nameHash) const noexcept {
    const ArchiveFile* f = getFileByNameHash(nameHash);
    return f ? f->id : -1;
}

Result<Archive> Archive::decodeFromSource(const ArchiveMeta& meta, const ByteSource& source, Allocator& alloc) noexcept {
    auto bytesRes = readAllBytes(source, alloc);
    if (!bytesRes.isOk()) {
        return Result<Archive>::err(bytesRes.status());
    }
    Vec<u8> bytes = rs::move(bytesRes.value());
    return decodeFromBytes(meta, Span<const u8>(bytes.data(), bytes.size()), alloc);
}

Result<Archive> Archive::decodeFromBytes(const ArchiveMeta& meta, Span<const u8> bytes, Allocator& alloc) noexcept {
    const i32 archiveId = meta.id;
    const i32 lastFileId = meta.lastFileId;
    const i32 fileCount = meta.fileCount;

    if (fileCount <= 0) {
        Vec<ArchiveFile> files(alloc);
        return Result<Archive>::ok(Archive(archiveId, lastFileId, rs::move(files), alloc));
    }

    if (fileCount == 1) {
        Vec<u8> data(alloc);
        auto rr = data.resize(bytes.size());
        if (!rr.isOk()) {
            return Result<Archive>::err(rr.status());
        }
        for (std::size_t i = 0; i < bytes.size(); i++) {
            data[i] = bytes[i];
        }

        Vec<ArchiveFile> files(alloc);
        const i32 nameHash = meta.fileNameHashes.size() >= 1 ? meta.fileNameHashes[0] : 0;
        auto pr = files.emplaceBack(lastFileId, archiveId, rs::move(data), nameHash);
        if (!pr.isOk()) {
            return Result<Archive>::err(pr.status());
        }
        return Result<Archive>::ok(Archive(archiveId, lastFileId, rs::move(files), alloc));
    }

    if (bytes.size() < 1) {
        return Result<Archive>::err(Status::Truncated);
    }

    const u8 chunksU8 = bytes[bytes.size() - 1];
    const i32 chunks = static_cast<i32>(chunksU8);
    if (chunks <= 0) {
        return Result<Archive>::err(Status::BadFormat);
    }

    const std::size_t tableBytes = static_cast<std::size_t>(chunks) * static_cast<std::size_t>(fileCount) * 4;
    if (tableBytes + 1 > bytes.size()) {
        return Result<Archive>::err(Status::BadFormat);
    }
    const std::size_t tableOffset = bytes.size() - 1 - tableBytes;

    // Parse chunk table.
    Vec<i32> chunkSizes(alloc);
    auto rr = chunkSizes.resize(static_cast<std::size_t>(chunks) * static_cast<std::size_t>(fileCount));
    if (!rr.isOk()) {
        return Result<Archive>::err(rr.status());
    }
    Vec<i32> fileSizes(alloc);
    rr = fileSizes.resize(static_cast<std::size_t>(fileCount));
    if (!rr.isOk()) {
        return Result<Archive>::err(rr.status());
    }
    for (std::size_t i = 0; i < fileSizes.size(); i++) {
        fileSizes[i] = 0;
    }

    std::size_t tOff = tableOffset;
    for (i32 chunk = 0; chunk < chunks; chunk++) {
        i32 lastChunkFileSize = 0;
        for (i32 fileIdx = 0; fileIdx < fileCount; fileIdx++) {
            if (tOff + 4 > bytes.size() - 1) {
                return Result<Archive>::err(Status::Truncated);
            }
            const i32 delta = readI32BE(bytes.data() + tOff);
            tOff += 4;
            lastChunkFileSize += delta;
            const std::size_t idx = static_cast<std::size_t>(chunk) * static_cast<std::size_t>(fileCount) +
                                    static_cast<std::size_t>(fileIdx);
            chunkSizes[idx] = lastChunkFileSize;
            fileSizes[static_cast<std::size_t>(fileIdx)] += lastChunkFileSize;
        }
    }

    // Allocate file buffers.
    Vec<ArchiveFile> files(alloc);
    rr = files.resize(static_cast<std::size_t>(fileCount));
    if (!rr.isOk()) {
        return Result<Archive>::err(rr.status());
    }

    Vec<std::size_t> fileOffsets(alloc);
    rr = fileOffsets.resize(static_cast<std::size_t>(fileCount));
    if (!rr.isOk()) {
        return Result<Archive>::err(rr.status());
    }
    for (std::size_t i = 0; i < fileOffsets.size(); i++) {
        fileOffsets[i] = 0;
    }

    for (i32 fileIdx = 0; fileIdx < fileCount; fileIdx++) {
        const std::size_t idx = static_cast<std::size_t>(fileIdx);
        files[idx].id = meta.fileIds.size() > idx ? meta.fileIds[idx] : fileIdx;
        files[idx].archiveId = archiveId;
        files[idx].nameHash = meta.fileNameHashes.size() > idx ? meta.fileNameHashes[idx] : 0;

        const i32 sizeI32 = fileSizes[idx];
        if (sizeI32 < 0) {
            return Result<Archive>::err(Status::BadFormat);
        }
        Vec<u8> data(alloc);
        rr = data.resize(static_cast<std::size_t>(sizeI32));
        if (!rr.isOk()) {
            return Result<Archive>::err(rr.status());
        }
        files[idx].data = rs::move(data);
    }

    // Payload is everything before tableOffset.
    std::size_t inputOffset = 0;
    const std::size_t payloadEnd = tableOffset;

    for (i32 chunk = 0; chunk < chunks; chunk++) {
        for (i32 fileIdx = 0; fileIdx < fileCount; fileIdx++) {
            const std::size_t idx = static_cast<std::size_t>(chunk) * static_cast<std::size_t>(fileCount) +
                                    static_cast<std::size_t>(fileIdx);
            const i32 chunkSizeI32 = chunkSizes[idx];
            if (chunkSizeI32 < 0) {
                return Result<Archive>::err(Status::BadFormat);
            }
            const std::size_t chunkSize = static_cast<std::size_t>(chunkSizeI32);

            const std::size_t dstOff = fileOffsets[static_cast<std::size_t>(fileIdx)];
            Vec<u8>& dst = files[static_cast<std::size_t>(fileIdx)].data;
            if (dstOff + chunkSize > dst.size()) {
                return Result<Archive>::err(Status::BadFormat);
            }
            if (inputOffset + chunkSize > payloadEnd) {
                return Result<Archive>::err(Status::BadFormat);
            }
            for (std::size_t i = 0; i < chunkSize; i++) {
                dst[dstOff + i] = bytes[inputOffset + i];
            }
            fileOffsets[static_cast<std::size_t>(fileIdx)] = dstOff + chunkSize;
            inputOffset += chunkSize;
        }
    }

    return Result<Archive>::ok(Archive(archiveId, lastFileId, rs::move(files), alloc));
}

Result<Archive> Archive::create(i32 archiveId, Vec<u8> data, Allocator& alloc) noexcept {
    Vec<ArchiveFile> files(alloc);
    auto pr = files.emplaceBack(0, archiveId, rs::move(data));
    if (!pr.isOk()) {
        return Result<Archive>::err(pr.status());
    }
    return Result<Archive>::ok(Archive(archiveId, 0, rs::move(files), alloc));
}

Result<Archive> Archive::decodeOld(
    i32 archiveId,
    Span<const u8> data,
    bool multipleFiles,
    const CompressionHandler& compressionHandler,
    Allocator& alloc) noexcept {
    if (!multipleFiles) {
        auto decRes = decompressDatGzip(data, compressionHandler, alloc);
        if (!decRes.isOk()) {
            return Result<Archive>::err(decRes.status());
        }
        return create(archiveId, rs::move(decRes.value()), alloc);
    }

    Uint8ArrayReader reader(data);

    u32 actualSize = 0;
    u32 size = 0;
    Status s = reader.readMedium(&actualSize);
    if (!ok(s)) {
        return Result<Archive>::err(s);
    }
    s = reader.readMedium(&size);
    if (!ok(s)) {
        return Result<Archive>::err(s);
    }
    const bool isCompressed = actualSize != size;

    Span<const u8> metaBytes;
    Vec<u8> decompressed(alloc);

    if (isCompressed) {
        Span<const u8> compressedSpan;
        s = reader.readBytes(static_cast<std::size_t>(size), &compressedSpan);
        if (!ok(s)) {
            return Result<Archive>::err(s);
        }
        auto decRes = compressionHandler.decompressBzip2(compressedSpan, static_cast<std::size_t>(actualSize), alloc);
        if (!decRes.isOk()) {
            return Result<Archive>::err(decRes.status());
        }
        decompressed = rs::move(decRes.value());
        metaBytes = Span<const u8>(decompressed.data(), decompressed.size());
    } else {
        metaBytes = data.subspan(reader.tell(), data.size() - reader.tell());
    }

    Uint8ArrayReader metaReader(metaBytes);
    Uint8ArrayReader dataReader(metaBytes);

    u16 fileCountU16 = 0;
    s = metaReader.readUnsignedShort(&fileCountU16);
    if (!ok(s)) {
        return Result<Archive>::err(s);
    }
    const i32 fileCount = static_cast<i32>(fileCountU16);
    if (fileCount <= 0) {
        Vec<ArchiveFile> files(alloc);
        return Result<Archive>::ok(Archive(archiveId, -1, rs::move(files), alloc));
    }

    const i32 lastFileId = fileCount - 1;

    const std::size_t tableStart = metaReader.tell();
    s = dataReader.seek(tableStart + static_cast<std::size_t>(fileCount) * 10);
    if (!ok(s)) {
        return Result<Archive>::err(s);
    }

    Vec<ArchiveFile> files(alloc);
    auto rr = files.resize(static_cast<std::size_t>(fileCount));
    if (!rr.isOk()) {
        return Result<Archive>::err(rr.status());
    }

    for (i32 i = 0; i < fileCount; i++) {
        i32 nameHash = 0;
        u32 fileActualSize = 0;
        u32 fileSize = 0;
        s = metaReader.readInt(&nameHash);
        if (!ok(s)) return Result<Archive>::err(s);
        s = metaReader.readMedium(&fileActualSize);
        if (!ok(s)) return Result<Archive>::err(s);
        s = metaReader.readMedium(&fileSize);
        if (!ok(s)) return Result<Archive>::err(s);

        Vec<u8> fileData(alloc);
        if (isCompressed) {
            Span<const u8> fileSpan;
            s = dataReader.readBytes(static_cast<std::size_t>(fileSize), &fileSpan);
            if (!ok(s)) return Result<Archive>::err(s);
            rr = fileData.resize(fileSpan.size());
            if (!rr.isOk()) return Result<Archive>::err(rr.status());
            for (std::size_t j = 0; j < fileSpan.size(); j++) {
                fileData[j] = fileSpan[j];
            }
        } else {
            Span<const u8> fileSpan;
            s = dataReader.readBytes(static_cast<std::size_t>(fileSize), &fileSpan);
            if (!ok(s)) return Result<Archive>::err(s);
            auto decRes = compressionHandler.decompressBzip2(fileSpan, static_cast<std::size_t>(fileActualSize), alloc);
            if (!decRes.isOk()) return Result<Archive>::err(decRes.status());
            fileData = rs::move(decRes.value());
        }

        files[static_cast<std::size_t>(i)].id = i;
        files[static_cast<std::size_t>(i)].archiveId = archiveId;
        files[static_cast<std::size_t>(i)].nameHash = nameHash;
        files[static_cast<std::size_t>(i)].data = rs::move(fileData);
    }

    return Result<Archive>::ok(Archive(archiveId, lastFileId, rs::move(files), alloc));
}

} // namespace rs
