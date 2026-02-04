#pragma once

#include <cstddef>

#include "../../cache/ArchiveMeta.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Result.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/ByteSourceReader.hpp"
#include "../../types.hpp"

namespace rs {

class ReferenceTable {
public:
    static Result<ReferenceTable> decodeFromReader(ByteSourceReader& reader, Allocator& alloc) noexcept;

    [[nodiscard]] bool archiveExists(i32 id) const noexcept;
    [[nodiscard]] i32 getArchiveIdByNameHash(i32 nameHash) const noexcept;
    Status getArchiveMeta(i32 id, ArchiveMeta* out) const noexcept;

    [[nodiscard]] Span<const i32> archiveIds() const noexcept { return archiveIds_.span(); }
    [[nodiscard]] i32 archiveCount() const noexcept { return archiveCount_; }
    [[nodiscard]] i32 lastArchiveId() const noexcept { return lastArchiveId_; }

private:
    i32 protocol_ = 0;
    i32 revision_ = 0;
    bool named_ = false;
    bool usesWhirlpool_ = false;
    i32 archiveCount_ = 0;
    i32 lastArchiveId_ = 0;

    Vec<i32> archiveIds_;
    Vec<i32> archiveNameHashes_;
    Vec<i32> archiveFileCounts_;
    Vec<i32> archiveLastFileIds_;
    Vec<Vec<i32>> archiveFileIds_;
    Vec<Vec<i32>> archiveFileNameHashes_;
};

} // namespace rs
