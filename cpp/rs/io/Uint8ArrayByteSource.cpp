#include "Uint8ArrayByteSource.hpp"

#include <cstring>

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"

namespace rs {

Status Uint8ArrayByteSource::readInto(std::size_t offset, Span<u8> target) const noexcept {
    if (!data_ && size_ != 0) {
        return Status::InvalidArgument;
    }
    if (offset > size_ || target.size() > size_ - offset) {
        return Status::OutOfRange;
    }
    if (target.size() == 0) {
        return Status::Ok;
    }
    std::memcpy(target.data(), data_ + offset, target.size());
    return Status::Ok;
}

bool Uint8ArrayByteSource::tryGetView(Span<const u8>* out) const noexcept {
    if (!out || (!data_ && size_ != 0)) {
        return false;
    }
    *out = Span<const u8>(data_, size_);
    return true;
}

} // namespace rs
