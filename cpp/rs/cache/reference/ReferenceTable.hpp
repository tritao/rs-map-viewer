#pragma once

#include <cstddef>
#include <optional>
#include <unordered_map>
#include <vector>

#include "../../io/ByteReader.hpp"
#include "../../types.hpp"
#include "ArchiveReference.hpp"

namespace rs {

class ReferenceTable {
public:
    static ReferenceTable decodeFromReader(ByteReader& reader);

    [[nodiscard]] bool archiveExists(i32 id) const;
    [[nodiscard]] const ArchiveReference* getArchiveReference(i32 id) const;

    [[nodiscard]] const std::vector<i32>& archiveIds() const { return archiveIds_; }
    [[nodiscard]] i32 archiveCount() const { return archiveCount_; }
    [[nodiscard]] i32 lastArchiveId() const { return lastArchiveId_; }

private:
    i32 protocol_ = 0;
    i32 revision_ = 0;
    bool named_ = false;
    bool usesWhirlpool_ = false;
    i32 archiveCount_ = 0;
    i32 lastArchiveId_ = 0;

    std::unordered_map<i32, i32> archiveIdIndexMap_;
    std::vector<i32> archiveIds_;

    std::vector<i32> archiveNameHashes_;
    std::vector<std::vector<u8>> archiveWhirlpools_;
    std::vector<i32> archiveCrcs_;
    std::vector<i32> archiveRevisions_;
    std::vector<i32> archiveFileCounts_;
    std::vector<i32> archiveLastFileIds_;
    std::vector<std::vector<i32>> archiveFileIds_;
    std::vector<std::vector<i32>> archiveFileNameHashes_;

    mutable std::vector<std::optional<ArchiveReference>> archiveReferenceCache_;
};

} // namespace rs
