#pragma once

#include <optional>
#include <vector>

#include "../compression/CompressionHandler.hpp"
#include "../io/ByteSource.hpp"
#include "format/Archive.hpp"
#include "format/Container.hpp"
#include "reference/ReferenceTable.hpp"
#include "store/CacheStore.hpp"

namespace rs {

class Dat2CacheIndex {
public:
    static Dat2CacheIndex fromDat2Store(i32 id, const CacheStore& store, const CompressionHandler& compressionHandler);

    Dat2CacheIndex(i32 id, ReferenceTable table, const CacheStore& store, const CompressionHandler& compressionHandler)
        : id_(id), table_(std::move(table)), store_(store), compressionHandler_(compressionHandler) {}

    [[nodiscard]] i32 id() const { return id_; }
    [[nodiscard]] const std::vector<i32>& getArchiveIds() const { return table_.archiveIds(); }
    [[nodiscard]] i32 getArchiveCount() const { return table_.archiveCount(); }
    [[nodiscard]] i32 getLastArchiveId() const { return table_.lastArchiveId(); }

    [[nodiscard]] std::optional<ArchiveMeta> getArchiveMeta(i32 archiveId) const;

private:
    i32 id_;
    ReferenceTable table_;
    const CacheStore& store_;
    const CompressionHandler& compressionHandler_;
};

} // namespace rs

