#pragma once

#include "../../cache/CacheIndex.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Result.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/BytesProvider.hpp"
#include "../../types.hpp"
#include "SeqFrame.hpp"
#include "SeqFrameLoaderCommon.hpp"

namespace rs {

class DatSeqFrameLoader final {
public:
    DatSeqFrameLoader() noexcept
        : alloc_(&defaultAllocator()),
          frames_(defaultAllocator()),
          hasFrame_(defaultAllocator()),
          statusById_(defaultAllocator()) {}

    [[nodiscard]] i32 getCount() const noexcept { return count_; }

    static Result<DatSeqFrameLoader> create(
        IndexFileBytesProvider frameMapSource,
        Allocator& alloc = defaultAllocator()) noexcept {
        DatSeqFrameLoader out;
        out.alloc_ = &alloc;
        out.frames_ = Vec<SeqFrame>(alloc);
        out.hasFrame_ = Vec<u8>(alloc);
        out.statusById_ = Vec<Status>(alloc);

        const CacheIndex* index = frameMapSource.index();
        if (!index) {
            return Result<DatSeqFrameLoader>::ok(rs::move(out));
        }

        SeqFrameDecodeScratch scratch(alloc);
        Vec<i32> decodedIds(alloc);
        Vec<SeqFrame> decodedFrames(alloc);

        const i32 lastMapId = index->lastArchiveId();
        for (i32 mapId = 0; mapId <= lastMapId; mapId++) {
            Vec<u8> bytes(alloc);
            const Status loadStatus = frameMapSource.tryGetBytes(mapId, &bytes, alloc);
            if (!ok(loadStatus)) {
                continue;
            }
            const Status decodeStatus = decodeDatSeqFrameMap(
                Span<const u8>(bytes.data(), bytes.size()),
                &scratch,
                alloc,
                &decodedIds,
                &decodedFrames);
            if (!ok(decodeStatus)) {
                continue;
            }
            Status storeStatus = out.storeDecodedFrames(decodedIds, decodedFrames);
            if (!ok(storeStatus)) {
                return Result<DatSeqFrameLoader>::err(storeStatus);
            }
        }

        return Result<DatSeqFrameLoader>::ok(rs::move(out));
    }

    Status tryLoad(i32 id, SeqFrame* out) const noexcept {
        if (!out) return Status::InvalidArgument;
        if (id < 0) return Status::OutOfRange;
        const std::size_t idx = static_cast<std::size_t>(id);
        if (idx >= hasFrame_.size() || hasFrame_[idx] == 0) {
            return Status::NotFound;
        }
        const Status st = (idx < statusById_.size()) ? statusById_[idx] : Status::NotFound;
        if (!ok(st)) {
            return st;
        }
        return cloneSeqFrame(frames_[idx], *alloc_, out);
    }

    Status tryGet(i32 id, SeqFrame* out) const noexcept {
        return tryLoad(id, out);
    }

    void clearCache() noexcept {}

private:
    Status ensureFrameCapacity(i32 id) noexcept {
        if (id < 0) return Status::BadFormat;
        const std::size_t need = static_cast<std::size_t>(id) + 1;
        if (need <= frames_.size()) {
            return Status::Ok;
        }

        const std::size_t oldSize = frames_.size();
        auto rr = frames_.resize(need);
        if (!rr.isOk()) return rr.status();
        rr = hasFrame_.resize(need);
        if (!rr.isOk()) return rr.status();
        rr = statusById_.resize(need);
        if (!rr.isOk()) return rr.status();

        for (std::size_t i = oldSize; i < need; i++) {
            frames_[i] = SeqFrame(*alloc_);
            hasFrame_[i] = 0;
            statusById_[i] = Status::NotFound;
        }
        return Status::Ok;
    }

    Status storeDecodedFrames(const Vec<i32>& ids, const Vec<SeqFrame>& frames) noexcept {
        if (ids.size() != frames.size()) {
            return Status::BadFormat;
        }
        for (std::size_t i = 0; i < ids.size(); i++) {
            const i32 id = ids[i];
            Status s = ensureFrameCapacity(id);
            if (!ok(s)) return s;

            SeqFrame copy(*alloc_);
            s = cloneSeqFrame(frames[i], *alloc_, &copy);
            if (!ok(s)) return s;
            const std::size_t idx = static_cast<std::size_t>(id);
            frames_[idx] = rs::move(copy);
            hasFrame_[idx] = 1;
            statusById_[idx] = Status::Ok;
            if (id + 1 > count_) {
                count_ = id + 1;
            }
        }
        return Status::Ok;
    }

    Allocator* alloc_ = nullptr;
    i32 count_ = 0;
    Vec<SeqFrame> frames_{};
    Vec<u8> hasFrame_{};
    Vec<Status> statusById_{};
};

} // namespace rs

