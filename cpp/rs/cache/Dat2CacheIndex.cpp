#include "Dat2CacheIndex.hpp"

#include <memory>
#include <optional>
#include <stdexcept>
#include <utility>
#include <vector>

#include "../compression/CompressionHandler.hpp"
#include "../io/ByteSource.hpp"
#include "../io/ByteSourceReader.hpp"
#include "../io/Uint8ArrayByteSource.hpp"
#include "../types.hpp"
#include "format/Archive.hpp"
#include "format/Container.hpp"
#include "reference/ReferenceTable.hpp"
#include "store/CacheStore.hpp"

namespace rs {

Dat2CacheIndex Dat2CacheIndex::fromDat2Store(i32 id, const CacheStore& store, const CompressionHandler& compressionHandler) {
    const ByteSourcePtr metaSource = store.openArchiveReader(255, id);
    if (!metaSource || metaSource->size() == 0) {
        throw std::runtime_error("Dat2CacheIndex: meta source missing");
    }

    Container container = Container::decodeFromSource(*metaSource, std::nullopt, compressionHandler);
    auto tableBytes = std::make_shared<std::vector<u8>>(std::move(container.data));
    ByteSourcePtr tableSource = std::make_shared<Uint8ArrayByteSource>(tableBytes);
    ByteSourceReader reader(tableSource);
    ReferenceTable table = ReferenceTable::decodeFromReader(reader);
    return Dat2CacheIndex(id, std::move(table), store, compressionHandler);
}

std::optional<ArchiveMeta> Dat2CacheIndex::getArchiveMeta(i32 archiveId) const {
    const auto* ref = table_.getArchiveReference(archiveId);
    if (!ref) {
        return std::nullopt;
    }

    ArchiveMeta meta;
    meta.id = ref->id;
    meta.lastFileId = ref->lastFileId;
    meta.fileCount = ref->fileCount;
    meta.fileIds = ref->fileIds;
    meta.fileNameHashes = ref->fileNameHashes;
    return meta;
}

} // namespace rs
