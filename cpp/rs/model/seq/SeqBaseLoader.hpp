#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/BytesProvider.hpp"
#include "../../types.hpp"
#include "SeqBase.hpp"

namespace rs {

// Mirrors src/rs/model/seq/SeqBaseLoader.ts (Dat2SeqBaseLoader).
class Dat2SeqBaseLoader final {
public:
    Dat2SeqBaseLoader() noexcept
        : cacheInfo_(),
          baseSource_(),
          alloc_(&defaultAllocator()),
          bases_(defaultAllocator()),
          statusById_(defaultAllocator()),
          attempted_(defaultAllocator()) {}

    explicit Dat2SeqBaseLoader(
        const CacheInfo& cacheInfo,
        IndexFileBytesProvider baseSource,
        Allocator& alloc = defaultAllocator()) noexcept
        : cacheInfo_(cacheInfo),
          baseSource_(baseSource),
          alloc_(&alloc),
          bases_(alloc),
          statusById_(alloc),
          attempted_(alloc) {
        const CacheIndex* index = baseSource_.index();
        if (!index) {
            return;
        }
        const i32 lastBaseId = index->lastArchiveId();
        if (lastBaseId < 0) {
            return;
        }
        const std::size_t count = static_cast<std::size_t>(lastBaseId + 1);
        auto rr = bases_.resize(count);
        if (!rr.isOk()) {
            return;
        }
        rr = statusById_.resize(count);
        if (!rr.isOk()) {
            return;
        }
        rr = attempted_.resize(count);
        if (!rr.isOk()) {
            return;
        }
        for (std::size_t i = 0; i < count; i++) {
            statusById_[i] = Status::NotFound;
            attempted_[i] = 0;
        }
    }

    [[nodiscard]] i32 getCount() const noexcept {
        return static_cast<i32>(statusById_.size());
    }

    Status tryLoad(i32 id, const SeqBase** out) const noexcept {
        if (!out) {
            return Status::InvalidArgument;
        }
        *out = nullptr;
        if (id < 0) {
            return Status::OutOfRange;
        }
        const std::size_t idx = static_cast<std::size_t>(id);
        if (idx >= attempted_.size()) {
            return Status::NotFound;
        }

        if (attempted_[idx] != 0) {
            const Status s = statusById_[idx];
            if (!ok(s)) {
                return s;
            }
            *out = &bases_[idx];
            return Status::Ok;
        }

        attempted_[idx] = 1;

        Vec<u8> bytes(*alloc_);
        Status s = baseSource_.tryGetBytes(id, &bytes, *alloc_);
        if (!ok(s)) {
            statusById_[idx] = s;
            return s;
        }

        SeqBase decoded(id, *alloc_);
        s = decodeDat2SeqBase(
            cacheInfo_,
            id,
            Span<const u8>(bytes.data(), bytes.size()),
            &decoded,
            *alloc_);
        statusById_[idx] = s;
        if (!ok(s)) {
            return s;
        }

        bases_[idx] = rs::move(decoded);
        *out = &bases_[idx];
        return Status::Ok;
    }

    Status tryGet(i32 id, const SeqBase** out) const noexcept {
        return tryLoad(id, out);
    }

    void clearCache() noexcept {
        for (std::size_t i = 0; i < attempted_.size(); i++) {
            attempted_[i] = 0;
            statusById_[i] = Status::NotFound;
        }
    }

private:
    CacheInfo cacheInfo_{};
    IndexFileBytesProvider baseSource_{};
    Allocator* alloc_ = nullptr;

    mutable Vec<SeqBase> bases_{};
    mutable Vec<Status> statusById_{};
    mutable Vec<u8> attempted_{};
};

} // namespace rs
