#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Status.hpp"
#include "../../io/BytesProvider.hpp"
#include "../../types.hpp"
#include "SeqBaseLoader.hpp"
#include "SeqFrame.hpp"

namespace rs {

class Dat2SeqFrameLoader final {
public:
    Dat2SeqFrameLoader() noexcept
        : cacheInfo_(),
          frameSource_(),
          baseLoader_(),
          alloc_(&defaultAllocator()),
          scratch_(defaultAllocator()) {}

    Dat2SeqFrameLoader(
        const CacheInfo& cacheInfo,
        PackedIdGroupBytesProvider frameSource,
        Dat2SeqBaseLoader baseLoader,
        Allocator& alloc = defaultAllocator()) noexcept
        : cacheInfo_(cacheInfo),
          frameSource_(frameSource),
          baseLoader_(rs::move(baseLoader)),
          alloc_(&alloc),
          scratch_(alloc) {}

    Status tryLoad(i32 id, SeqFrame* out) const noexcept {
        if (!out) {
            return Status::InvalidArgument;
        }
        Vec<u8> bytes(*alloc_);
        Status s = frameSource_.tryGetBytes(id, &bytes, *alloc_);
        if (!ok(s)) {
            return s;
        }
        return decodeDat2SeqFrame(
            cacheInfo_,
            baseLoader_,
            Span<const u8>(bytes.data(), bytes.size()),
            &scratch_,
            *alloc_,
            out);
    }

    Status tryGet(i32 id, SeqFrame* out) const noexcept {
        return tryLoad(id, out);
    }

    void clearCache() noexcept {
        baseLoader_.clearCache();
    }

private:
    CacheInfo cacheInfo_{};
    PackedIdGroupBytesProvider frameSource_{};
    mutable Dat2SeqBaseLoader baseLoader_{};
    Allocator* alloc_ = nullptr;
    mutable SeqFrameDecodeScratch scratch_{};
};

} // namespace rs

