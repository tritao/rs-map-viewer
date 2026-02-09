#pragma once

#include "../core/Allocator.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../io/BytesProvider.hpp"
#include "../types.hpp"
#include "ModelData.hpp"

namespace rs {

// C++ equivalent of TS IndexModelLoader.
class IndexModelLoader final {
public:
    IndexModelLoader() noexcept
        : modelSource_(),
          alloc_(&defaultAllocator()),
          count_(0),
          errorStatusById_(defaultAllocator()),
          hasErrorById_(defaultAllocator()) {}

    explicit IndexModelLoader(
        IndexFileBytesProvider modelSource,
        Allocator& alloc = defaultAllocator()) noexcept
        : modelSource_(modelSource),
          alloc_(&alloc),
          count_(0),
          errorStatusById_(alloc),
          hasErrorById_(alloc) {
        const CacheIndex* index = modelSource_.index();
        if (!index) {
            return;
        }
        const i32 lastId = index->lastArchiveId();
        if (lastId < 0) {
            return;
        }
        count_ = lastId + 1;
        const std::size_t n = static_cast<std::size_t>(count_);
        auto rr = errorStatusById_.resize(n);
        if (!rr.isOk()) return;
        rr = hasErrorById_.resize(n);
        if (!rr.isOk()) return;
        for (std::size_t i = 0; i < n; i++) {
            errorStatusById_[i] = Status::NotFound;
            hasErrorById_[i] = 0;
        }
    }

    [[nodiscard]] i32 getCount() const noexcept { return count_; }

    Status tryLoad(i32 id, ModelData* out) const noexcept {
        if (!out) return Status::InvalidArgument;
        if (id < 0) return Status::OutOfRange;

        const std::size_t idx = static_cast<std::size_t>(id);
        if (idx < hasErrorById_.size() && hasErrorById_[idx] != 0) {
            return errorStatusById_[idx];
        }

        Vec<u8> bytes(*alloc_);
        Status s = modelSource_.tryGetBytes(id, &bytes, *alloc_);
        if (!ok(s)) {
            if (idx < hasErrorById_.size()) {
                hasErrorById_[idx] = 1;
                errorStatusById_[idx] = s;
            }
            return s;
        }

        ModelData decoded(*alloc_);
        s = decodeModelData(Span<const u8>(bytes.data(), bytes.size()), &decoded, *alloc_);
        if (!ok(s)) {
            if (idx < hasErrorById_.size()) {
                hasErrorById_[idx] = 1;
                errorStatusById_[idx] = s;
            }
            return s;
        }

        *out = rs::move(decoded);
        return Status::Ok;
    }

    Status tryGet(i32 id, ModelData* out) const noexcept {
        return tryLoad(id, out);
    }

    void clearCache() noexcept {
        for (std::size_t i = 0; i < hasErrorById_.size(); i++) {
            hasErrorById_[i] = 0;
            errorStatusById_[i] = Status::NotFound;
        }
    }

private:
    IndexFileBytesProvider modelSource_{};
    Allocator* alloc_ = nullptr;
    i32 count_ = 0;

    mutable Vec<Status> errorStatusById_{};
    mutable Vec<u8> hasErrorById_{};
};

} // namespace rs
