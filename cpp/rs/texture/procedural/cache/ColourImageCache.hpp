#pragma once

#include "../../../core/Allocator.hpp"
#include "../../../core/Result.hpp"
#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../core/Vec.hpp"
#include "../../../types.hpp"

namespace rs {

struct ColourLine final {
    Span<i32> r;
    Span<i32> g;
    Span<i32> b;
};

class ColourImageCache final {
public:
    ColourImageCache() = default;

    Status init(i32 slotCount, i32 lineCount, i32 width, Allocator& alloc) noexcept {
        if (slotCount <= 0 || lineCount <= 0 || width <= 0) {
            return Status::InvalidArgument;
        }
        slotCount_ = slotCount;
        lineCount_ = lineCount;
        width_ = width;
        usedSlots_ = 0;
        lastLine_ = -1;
        dirty_ = false;

        pixels_ = Vec<i32>(alloc);
        slotByLine_ = Vec<i32>(alloc);
        lineBySlot_ = Vec<i32>(alloc);
        lruPrev_ = Vec<i32>(alloc);
        lruNext_ = Vec<i32>(alloc);

        if (slotCount_ == lineCount_) {
            usedLine_ = Vec<u8>(alloc);
            auto rr1 = usedLine_.resize(static_cast<std::size_t>(lineCount_));
            if (!rr1.isOk()) {
                return rr1.status();
            }
            for (std::size_t i = 0; i < usedLine_.size(); i++) {
                usedLine_[i] = 0;
            }
            auto rr2 = pixels_.resize(3ull * static_cast<std::size_t>(slotCount_) * static_cast<std::size_t>(width_));
            if (!rr2.isOk()) {
                return rr2.status();
            }
            for (std::size_t i = 0; i < pixels_.size(); i++) {
                pixels_[i] = 0;
            }
            return Status::Ok;
        }

        auto rr3 = pixels_.resize(3ull * static_cast<std::size_t>(slotCount_) * static_cast<std::size_t>(width_));
        if (!rr3.isOk()) {
            return rr3.status();
        }
        for (std::size_t i = 0; i < pixels_.size(); i++) {
            pixels_[i] = 0;
        }
        auto rr4 = slotByLine_.resize(static_cast<std::size_t>(lineCount_));
        if (!rr4.isOk()) {
            return rr4.status();
        }
        for (std::size_t i = 0; i < slotByLine_.size(); i++) {
            slotByLine_[i] = -1;
        }
        auto rr5 = lineBySlot_.resize(static_cast<std::size_t>(slotCount_));
        if (!rr5.isOk()) {
            return rr5.status();
        }
        auto rr6 = lruPrev_.resize(static_cast<std::size_t>(slotCount_));
        if (!rr6.isOk()) {
            return rr6.status();
        }
        auto rr7 = lruNext_.resize(static_cast<std::size_t>(slotCount_));
        if (!rr7.isOk()) {
            return rr7.status();
        }
        for (std::size_t i = 0; i < lineBySlot_.size(); i++) {
            lineBySlot_[i] = -1;
            lruPrev_[i] = -1;
            lruNext_[i] = -1;
        }
        lruHead_ = -1;
        lruTail_ = -1;
        return Status::Ok;
    }

    void reset() noexcept {
        slotCount_ = 0;
        lineCount_ = 0;
        width_ = 0;
        usedSlots_ = 0;
        lastLine_ = -1;
        dirty_ = false;
        lruHead_ = -1;
        lruTail_ = -1;
        pixels_.clear();
        usedLine_.clear();
        slotByLine_.clear();
        lineBySlot_.clear();
        lruPrev_.clear();
        lruNext_.clear();
    }

    // Like reset(), but also frees backing storage so capacity doesn't stick around.
    void releaseMemory() noexcept {
        reset();
        pixels_.releaseMemory();
        usedLine_.releaseMemory();
        slotByLine_.releaseMemory();
        lineBySlot_.releaseMemory();
        lruPrev_.releaseMemory();
        lruNext_.releaseMemory();
    }

    [[nodiscard]] bool dirty() const noexcept { return dirty_; }

    void markAllUsed() noexcept {
        if (slotCount_ != lineCount_ || usedLine_.size() != static_cast<std::size_t>(lineCount_)) {
            return;
        }
        for (std::size_t i = 0; i < usedLine_.size(); i++) {
            usedLine_[i] = 1;
        }
    }

    Status getAll(Span<i32>* out) noexcept {
        if (!out) {
            return Status::InvalidArgument;
        }
        *out = Span<i32>(nullptr, 0);
        if (slotCount_ != lineCount_) {
            return Status::Unsupported;
        }
        markAllUsed();
        *out = Span<i32>(pixels_.data(), pixels_.size());
        return Status::Ok;
    }

    ColourLine get(i32 line) noexcept {
        dirty_ = false;
        if (line < 0 || line >= lineCount_) {
            dirty_ = true;
            return ColourLine{};
        }

        if (slotCount_ == lineCount_) {
            const std::size_t idx = static_cast<std::size_t>(line);
            dirty_ = (usedLine_[idx] == 0);
            usedLine_[idx] = 1;
            return lineFromSlot(static_cast<i32>(idx));
        }

        if (slotCount_ == 1) {
            dirty_ = (line != lastLine_);
            lastLine_ = line;
            return lineFromSlot(0);
        }

        i32 slotId = slotByLine_[static_cast<std::size_t>(line)];
        if (slotId < 0) {
            dirty_ = true;
            if (usedSlots_ < slotCount_) {
                slotId = usedSlots_++;
            } else {
                const i32 evict = lruTail_;
                if (evict < 0) {
                    dirty_ = true;
                    return ColourLine{};
                }
                const i32 oldLine = lineBySlot_[static_cast<std::size_t>(evict)];
                if (oldLine >= 0) {
                    slotByLine_[static_cast<std::size_t>(oldLine)] = -1;
                }
                removeFromLru(evict);
                slotId = evict;
            }
            lineBySlot_[static_cast<std::size_t>(slotId)] = line;
            slotByLine_[static_cast<std::size_t>(line)] = slotId;
        }

        touchLru(slotId);
        return lineFromSlot(slotId);
    }

private:
    i32 slotCount_ = 0;
    i32 lineCount_ = 0;
    i32 width_ = 0;

    bool dirty_ = false;
    i32 usedSlots_ = 0;
    i32 lastLine_ = -1;

    // Layout: [R plane][G plane][B plane], each plane is slotCount*width i32 values.
    Vec<i32> pixels_{};

    Vec<u8> usedLine_{};

    Vec<i32> slotByLine_{};
    Vec<i32> lineBySlot_{};

    Vec<i32> lruPrev_{};
    Vec<i32> lruNext_{};
    i32 lruHead_ = -1;
    i32 lruTail_ = -1;

    [[nodiscard]] ColourLine lineFromSlot(i32 slotId) noexcept {
        const std::size_t slot = static_cast<std::size_t>(slotId);
        const std::size_t w = static_cast<std::size_t>(width_);
        const std::size_t planeSize = static_cast<std::size_t>(slotCount_) * w;
        const std::size_t offR = slot * w;
        const std::size_t offG = planeSize + slot * w;
        const std::size_t offB = 2 * planeSize + slot * w;
        return ColourLine{
            Span<i32>(pixels_.data() + offR, w),
            Span<i32>(pixels_.data() + offG, w),
            Span<i32>(pixels_.data() + offB, w),
        };
    }

    void removeFromLru(i32 slotId) noexcept {
        const std::size_t idx = static_cast<std::size_t>(slotId);
        const i32 prev = lruPrev_[idx];
        const i32 next = lruNext_[idx];

        if (prev >= 0) {
            lruNext_[static_cast<std::size_t>(prev)] = next;
        } else {
            lruHead_ = next;
        }
        if (next >= 0) {
            lruPrev_[static_cast<std::size_t>(next)] = prev;
        } else {
            lruTail_ = prev;
        }

        lruPrev_[idx] = -1;
        lruNext_[idx] = -1;
    }

    void touchLru(i32 slotId) noexcept {
        const std::size_t idx = static_cast<std::size_t>(slotId);
        if (lruHead_ == slotId) {
            return;
        }

        if (lruPrev_[idx] >= 0 || lruNext_[idx] >= 0 || lruTail_ == slotId) {
            removeFromLru(slotId);
        }

        lruPrev_[idx] = -1;
        lruNext_[idx] = lruHead_;
        if (lruHead_ >= 0) {
            lruPrev_[static_cast<std::size_t>(lruHead_)] = slotId;
        }
        lruHead_ = slotId;
        if (lruTail_ < 0) {
            lruTail_ = slotId;
        }
    }
};

} // namespace rs
