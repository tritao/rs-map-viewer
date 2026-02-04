#include "ByteSourceSlice.hpp"

#include <cstddef>

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../io/ByteSource.hpp"
#include "../types.hpp"

namespace rs {

ByteSourceSlice::ByteSourceSlice(const ByteSource* source, std::size_t start, std::size_t size) noexcept
    : source_(source), start_(start), size_(size) {
    if (!source_) {
        start_ = 0;
        size_ = 0;
        return;
    }
    const std::size_t baseSize = source_->size();
    if (start_ > baseSize || size_ > baseSize - start_) {
        source_ = nullptr;
        start_ = 0;
        size_ = 0;
    }
}

Status ByteSourceSlice::readInto(std::size_t offset, Span<u8> target) const noexcept {
    if (!source_) {
        return Status::InvalidArgument;
    }
    if (offset > size_ || target.size() > size_ - offset) {
        return Status::OutOfRange;
    }
    return source_->readInto(start_ + offset, target);
}

bool ByteSourceSlice::tryGetView(Span<const u8>* out) const noexcept {
    if (!source_ || !out) {
        return false;
    }
    Span<const u8> base;
    if (!source_->tryGetView(&base)) {
        return false;
    }
    if (start_ > base.size() || size_ > base.size() - start_) {
        return false;
    }
    *out = base.subspan(start_, size_);
    return true;
}

} // namespace rs
