#include "ByteSourceReader.hpp"

#include <cstring>
#include <stdexcept>

namespace rs {

ByteSourceReader::ByteSourceReader(ByteSourcePtr source, std::size_t windowSize) : source_(std::move(source)) {
    if (!source_) {
        throw std::invalid_argument("ByteSourceReader: source is null");
    }
    window_.resize(windowSize);
}

void ByteSourceReader::seek(std::size_t position) {
    if (position > source_->size()) {
        throw std::out_of_range("ByteSourceReader: seek out of bounds");
    }
    position_ = position;
    windowStart_ = 0;
    windowEnd_ = 0;
}

void ByteSourceReader::skip(std::size_t amount) {
    seek(position_ + amount);
}

std::size_t ByteSourceReader::remaining() const {
    return source_->size() - position_;
}

void ByteSourceReader::ensure(std::size_t amount) {
    if (amount == 0) {
        return;
    }
    if (position_ + amount > source_->size()) {
        throw std::out_of_range("ByteSourceReader: read out of bounds");
    }

    if (position_ >= windowStart_ && position_ + amount <= windowEnd_) {
        return;
    }

    const std::size_t toRead = std::min<std::size_t>(window_.size(), source_->size() - position_);
    if (toRead == 0) {
        windowStart_ = position_;
        windowEnd_ = position_;
        return;
    }

    source_->readInto(position_, window_.data(), toRead);
    windowStart_ = position_;
    windowEnd_ = position_ + toRead;
}

i8 ByteSourceReader::peekByte() {
    ensure(1);
    const u8 value = window_[position_ - windowStart_];
    return static_cast<i8>(value);
}

u8 ByteSourceReader::peekUnsignedByte() {
    return static_cast<u8>(peekByte());
}

i8 ByteSourceReader::readByte() {
    const i8 value = peekByte();
    position_ += 1;
    return value;
}

u8 ByteSourceReader::readUnsignedByte() {
    return static_cast<u8>(readByte());
}

i16 ByteSourceReader::readShort() {
    const u16 v = (static_cast<u16>(readUnsignedByte()) << 8) | static_cast<u16>(readUnsignedByte());
    return static_cast<i16>(v);
}

u16 ByteSourceReader::readUnsignedShort() {
    return static_cast<u16>(readShort());
}

u32 ByteSourceReader::readMedium() {
    ensure(3);
    const std::size_t off = position_ - windowStart_;
    const u32 value = readU24BE(window_.data() + off);
    position_ += 3;
    return value;
}

i32 ByteSourceReader::readInt() {
    ensure(4);
    const std::size_t off = position_ - windowStart_;
    const i32 value = readI32BE(window_.data() + off);
    position_ += 4;
    return value;
}

u32 ByteSourceReader::readUnsignedInt() {
    ensure(4);
    const std::size_t off = position_ - windowStart_;
    const u32 value = readU32BE(window_.data() + off);
    position_ += 4;
    return value;
}

i32 ByteSourceReader::readBigSmart() {
    if (peekByte() < 0) {
        return readInt() & 0x7fffffff;
    }
    const u16 v = readUnsignedShort();
    if (v == 32767) {
        return -1;
    }
    return static_cast<i32>(v);
}

std::span<const u8> ByteSourceReader::readBytes(std::size_t amount) {
    if (amount == 0) {
        owned_.clear();
        return std::span<const u8>();
    }
    if (position_ + amount > source_->size()) {
        throw std::out_of_range("ByteSourceReader: readBytes out of bounds");
    }

    // Fast path: bytes entirely within current window.
    if (position_ >= windowStart_ && position_ + amount <= windowEnd_) {
        const std::size_t off = position_ - windowStart_;
        position_ += amount;
        return std::span<const u8>(window_.data() + off, amount);
    }

    owned_.resize(amount);
    source_->readInto(position_, owned_.data(), amount);
    position_ += amount;
    return std::span<const u8>(owned_.data(), owned_.size());
}

void ByteSourceReader::readBytesInto(u8* target, std::size_t length) {
    if (!target && length != 0) {
        throw std::invalid_argument("ByteSourceReader: target is null");
    }
    if (position_ + length > source_->size()) {
        throw std::out_of_range("ByteSourceReader: readBytesInto out of bounds");
    }
    if (length == 0) {
        return;
    }

    // Fast path: entirely within current window.
    if (position_ >= windowStart_ && position_ + length <= windowEnd_) {
        const std::size_t off = position_ - windowStart_;
        std::memcpy(target, window_.data() + off, length);
        position_ += length;
        return;
    }

    source_->readInto(position_, target, length);
    position_ += length;
}

} // namespace rs
