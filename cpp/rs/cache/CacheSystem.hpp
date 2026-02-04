#pragma once

#include "../compression/CompressionHandler.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"
#include "CacheIndex.hpp"
#include "CacheType.hpp"
#include "store/CacheStore.hpp"

namespace rs {

class CacheSystem {
public:
    static Result<CacheSystem> fromStore(
        CacheType cacheType,
        const CacheStore& store,
        Span<const i32> indexIds,
        const CompressionHandler& compressionHandler,
        Allocator& alloc) noexcept;

    CacheSystem() = default;

    [[nodiscard]] bool indexExists(i32 indexId) const noexcept;
    Status getIndex(i32 indexId, const CacheIndex** out) const noexcept;

private:
    explicit CacheSystem(Vec<CacheIndex> indices, const CompressionHandler& compressionHandler) noexcept
        : indices_(rs::move(indices)), compressionHandler_(&compressionHandler) {}

    Vec<CacheIndex> indices_;
    const CompressionHandler* compressionHandler_ = nullptr;
};

} // namespace rs

