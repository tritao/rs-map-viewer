#include "ByteSourceSlice.hpp"

#include <stdexcept>

namespace rs {

ByteSourceSlice::ByteSourceSlice(ByteSourcePtr source, std::size_t start, std::size_t size)
    : source_(std::move(source)), start_(start), size_(size) {
    if (!source_) {
        throw std::invalid_argument("ByteSourceSlice: source is null");
    }
    if (start_ > source_->size()) {
        throw std::out_of_range("ByteSourceSlice: invalid start");
    }
    if (size_ > source_->size() - start_) {
        throw std::out_of_range("ByteSourceSlice: slice out of bounds");
    }
}

ByteSourcePtr ByteSourceSlice::slice(std::size_t start, std::size_t size) const {
    if (start > size_) {
        throw std::out_of_range("ByteSourceSlice: nested start out of bounds");
    }
    if (size > size_ - start) {
        throw std::out_of_range("ByteSourceSlice: nested slice out of bounds");
    }
    return std::make_shared<ByteSourceSlice>(source_, start_ + start, size);
}

void ByteSourceSlice::readInto(std::size_t offset, u8* target, std::size_t length) const {
    if (offset > size_) {
        throw std::out_of_range("ByteSourceSlice: read offset out of bounds");
    }
    if (length > size_ - offset) {
        throw std::out_of_range("ByteSourceSlice: read length out of bounds");
    }
    if (length == 0) {
        return;
    }
    source_->readInto(start_ + offset, target, length);
}

std::optional<std::span<const u8>> ByteSourceSlice::tryGetUint8ArrayView() const {
    const auto view = source_->tryGetUint8ArrayView();
    if (!view) {
        return std::nullopt;
    }
    const auto v = *view;
    if (start_ > v.size() || size_ > v.size() - start_) {
        return std::nullopt;
    }
    return v.subspan(start_, size_);
}

} // namespace rs

