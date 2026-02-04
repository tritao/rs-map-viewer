#pragma once

#include "../../cache/ArchiveMeta.hpp"
#include "../../compression/CompressionHandler.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Result.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/ByteSource.hpp"
#include "../../types.hpp"
#include "ArchiveFile.hpp"

namespace rs {

class Archive {
public:
    static Result<Archive> decodeFromBytes(const ArchiveMeta& meta, Span<const u8> bytes, Allocator& alloc) noexcept;
    static Result<Archive> decodeFromSource(const ArchiveMeta& meta, const ByteSource& source, Allocator& alloc) noexcept;
    static Result<Archive> decodeOld(
        i32 archiveId,
        Span<const u8> data,
        bool multipleFiles,
        const CompressionHandler& compressionHandler,
        Allocator& alloc) noexcept;

    static Result<Archive> create(i32 archiveId, Vec<u8> data, Allocator& alloc) noexcept;

    Archive() = default;
    Archive(i32 id, i32 lastFileId, Vec<ArchiveFile> files, Allocator& alloc) noexcept;

    [[nodiscard]] Span<const ArchiveFile> files() const noexcept { return files_.span(); }
    [[nodiscard]] const ArchiveFile* getFile(i32 id) const noexcept;

private:
    i32 id_;
    i32 lastFileId_;
    Vec<ArchiveFile> files_;
    Vec<const ArchiveFile*> filesById_;
};

} // namespace rs
