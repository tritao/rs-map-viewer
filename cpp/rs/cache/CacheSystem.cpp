#include "CacheSystem.hpp"

#include <cstddef>

#include "../compression/CompressionHandler.hpp"
#include "../core/Allocator.hpp"
#include "../core/Move.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"
#include "CacheIndex.hpp"
#include "CacheType.hpp"
#include "store/CacheStore.hpp"

namespace rs {

Result<CacheSystem> CacheSystem::fromStore(
    CacheType cacheType,
    const CacheStore& store,
    Span<const i32> indexIds,
    const CompressionHandler& compressionHandler,
    Allocator& alloc) noexcept {
    Vec<CacheIndex> indices(alloc);

    auto r = indices.reserve(indexIds.size());
    if (!r.isOk()) {
        return Result<CacheSystem>::err(r.status());
    }

    for (std::size_t i = 0; i < indexIds.size(); i++) {
        const i32 id = indexIds[i];
        auto indexRes = CacheIndex::fromStore(cacheType, id, store, compressionHandler, alloc);
        if (!indexRes.isOk()) {
            return Result<CacheSystem>::err(indexRes.status());
        }
        (void)indices.pushBack(rs::move(indexRes.value()));
    }

    return Result<CacheSystem>::ok(CacheSystem(rs::move(indices), compressionHandler));
}

bool CacheSystem::indexExists(i32 indexId) const noexcept {
    for (std::size_t i = 0; i < indices_.size(); i++) {
        if (indices_[i].id() == indexId) {
            return true;
        }
    }
    return false;
}

Status CacheSystem::getIndex(i32 indexId, const CacheIndex** out) const noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    for (std::size_t i = 0; i < indices_.size(); i++) {
        if (indices_[i].id() == indexId) {
            *out = &indices_[i];
            return Status::Ok;
        }
    }
    *out = nullptr;
    return Status::NotFound;
}

} // namespace rs
