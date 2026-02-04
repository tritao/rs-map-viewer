#pragma once

#include "../compression/CompressionHandler.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../crypto/Xtea.hpp"
#include "../types.hpp"
#include "CacheIndex.hpp"
#include "CacheType.hpp"
#include "format/Archive.hpp"
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

    Status readArchiveBytes(i32 indexId, i32 archiveId, Vec<u8>* out, Allocator& alloc) const noexcept;
    Status readContainerPayload(i32 indexId, i32 archiveId, const XteaKey* key, Vec<u8>* out, Allocator& alloc) const noexcept;
    Status getArchiveMeta(i32 indexId, i32 archiveId, ArchiveMeta* out) const noexcept;
    [[nodiscard]] i32 getArchiveId(i32 indexId, const char* name) const noexcept;

    Result<Archive> getArchiveKey(i32 indexId, i32 archiveId, const XteaKey* key, Allocator& alloc) const noexcept;
    Result<Archive> getArchive(i32 indexId, i32 archiveId, Allocator& alloc) const noexcept {
        return getArchiveKey(indexId, archiveId, nullptr, alloc);
    }

private:
    explicit CacheSystem(Vec<CacheIndex> indices, const CompressionHandler& compressionHandler) noexcept
        : indices_(rs::move(indices)), compressionHandler_(&compressionHandler) {}

    Vec<CacheIndex> indices_;
    const CompressionHandler* compressionHandler_ = nullptr;
};

} // namespace rs
