#include "Dat2CacheIndex.hpp"

#include <stdexcept>

#include "../io/Uint8ArrayReader.hpp"
#include "../io/Uint8ArrayByteSource.hpp"

namespace rs {

Dat2CacheIndex Dat2CacheIndex::fromDat2Store(i32 id, const CacheStore& store, const CompressionHandler& compressionHandler) {
    const ByteSourcePtr metaSource = store.openArchiveReader(255, id);
    if (!metaSource || metaSource->size() == 0) {
        throw std::runtime_error("Dat2CacheIndex: meta source missing");
    }

    const Container container = Container::decodeFromSource(*metaSource, std::nullopt, compressionHandler);
    Uint8ArrayReader reader(std::span<const u8>(container.data.data(), container.data.size()));
    ReferenceTable table = ReferenceTable::decodeFromReader(reader);
    return Dat2CacheIndex(id, std::move(table), store, compressionHandler);
}

std::optional<ArchiveMeta> Dat2CacheIndex::getArchiveMeta(i32 archiveId) const {
    const auto refOpt = table_.getArchiveReference(archiveId);
    if (!refOpt) {
        return std::nullopt;
    }
    const auto& ref = *refOpt;

    ArchiveMeta meta;
    meta.id = ref.id;
    meta.lastFileId = ref.lastFileId;
    meta.fileCount = ref.fileCount;
    meta.fileIds = ref.fileIds;
    meta.fileNameHashes = ref.fileNameHashes;
    return meta;
}

} // namespace rs

