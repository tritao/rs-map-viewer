#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/BytesProvider.hpp"
#include "../../types.hpp"
#include "../seq/SeqBaseLoader.hpp"
#include "SkeletalSeq.hpp"

namespace rs {

// Mirrors src/rs/model/skeletal/SkeletalSeqLoader.ts (ProviderSkeletalSeqLoader path).
class ProviderSkeletalSeqLoader final {
public:
    ProviderSkeletalSeqLoader() noexcept
        : seqSource_(),
          baseLoader_(),
          alloc_(&defaultAllocator()) {}

    ProviderSkeletalSeqLoader(
        PackedIdGroupBytesProvider seqSource,
        Dat2SeqBaseLoader baseLoader,
        Allocator& alloc = defaultAllocator()) noexcept
        : seqSource_(seqSource),
          baseLoader_(rs::move(baseLoader)),
          alloc_(&alloc) {}

    Status tryLoad(i32 id, SkeletalSeq* out) const noexcept {
        if (!out) {
            return Status::InvalidArgument;
        }
        Vec<u8> bytes(*alloc_);
        const Status s = seqSource_.tryGetBytes(id, &bytes, *alloc_);
        if (!ok(s)) {
            return s;
        }
        return decodeDat2SkeletalSeq(
            baseLoader_,
            id,
            Span<const u8>(bytes.data(), bytes.size()),
            out);
    }

    Status tryGet(i32 id, SkeletalSeq* out) const noexcept {
        return tryLoad(id, out);
    }

    void clearCache() noexcept {
        baseLoader_.clearCache();
    }

private:
    PackedIdGroupBytesProvider seqSource_{};
    mutable Dat2SeqBaseLoader baseLoader_{};
    Allocator* alloc_ = nullptr;
};

} // namespace rs
