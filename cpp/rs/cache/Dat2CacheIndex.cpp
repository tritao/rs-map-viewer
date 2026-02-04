#include "Dat2CacheIndex.hpp"

#include "../cache/format/Container.hpp"
#include "../cache/store/CacheStore.hpp"
#include "../compression/CompressionHandler.hpp"
#include "../core/Allocator.hpp"
#include "../core/Move.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../io/ByteSourceReader.hpp"
#include "../io/Uint8ArrayByteSource.hpp"
#include "../types.hpp"
#include "reference/ReferenceTable.hpp"

namespace rs {

Result<Dat2CacheIndex> Dat2CacheIndex::fromDat2Store(
    i32 id,
    const CacheStore& store,
    const CompressionHandler& compressionHandler,
    Allocator& alloc) noexcept {
    Vec<u8> metaBytes(alloc);
    const Status s = store.readArchive(255, id, &metaBytes);
    if (!ok(s) || metaBytes.size() == 0) {
        return Result<Dat2CacheIndex>::err(ok(s) ? Status::NotFound : s);
    }

    Uint8ArrayByteSource metaSource(metaBytes.data(), metaBytes.size());
    auto containerRes = Container::decodeFromSource(metaSource, nullptr, compressionHandler, alloc);
    if (!containerRes.isOk()) {
        return Result<Dat2CacheIndex>::err(containerRes.status());
    }
    Container container = rs::move(containerRes.value());

    Uint8ArrayByteSource tableSource(container.data.data(), container.data.size());
    ByteSourceReader reader(&tableSource);
    auto tableRes = ReferenceTable::decodeFromReader(reader, alloc);
    if (!tableRes.isOk()) {
        return Result<Dat2CacheIndex>::err(tableRes.status());
    }

    return Result<Dat2CacheIndex>::ok(Dat2CacheIndex(id, rs::move(tableRes.value()), store, compressionHandler));
}

} // namespace rs
