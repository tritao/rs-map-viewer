#include "Uint8ArrayByteSource.hpp"

#include <cstring>
#include <stdexcept>

namespace rs {

Uint8ArrayByteSource::Uint8ArrayByteSource(std::shared_ptr<std::vector<u8>> bytes) : bytes_(std::move(bytes)) {
    if (!bytes_) {
        throw std::invalid_argument("Uint8ArrayByteSource: bytes is null");
    }
}

std::size_t Uint8ArrayByteSource::size() const {
    return bytes_->size();
}

ByteSourcePtr Uint8ArrayByteSource::slice(std::size_t start, std::size_t size) const {
    return std::make_shared<ByteSourceSlice>(std::make_shared<Uint8ArrayByteSource>(*this), start, size);
}

void Uint8ArrayByteSource::readInto(std::size_t offset, u8* target, std::size_t length) const {
    if (!target && length != 0) {
        throw std::invalid_argument("Uint8ArrayByteSource: target is null");
    }
    if (offset > bytes_->size() || length > bytes_->size() - offset) {
        throw std::out_of_range("Uint8ArrayByteSource: read out of bounds");
    }
    if (length == 0) {
        return;
    }
    std::memcpy(target, bytes_->data() + offset, length);
}

std::optional<std::span<const u8>> Uint8ArrayByteSource::tryGetUint8ArrayView() const {
    return std::span<const u8>(bytes_->data(), bytes_->size());
}

} // namespace rs
