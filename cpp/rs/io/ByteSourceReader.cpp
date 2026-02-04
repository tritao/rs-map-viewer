#include "ByteSourceReader.hpp"

#include <cstddef>
#include <cstring>

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../io/ByteSource.hpp"
#include "../io/Endian.hpp"
#include "../types.hpp"

namespace rs {

ByteSourceReader::ByteSourceReader(const ByteSource* source, std::size_t windowSize) : source_(source), window_(), owned_() {
    (void)window_.resize(windowSize);
}

Status ByteSourceReader::seek(std::size_t position) noexcept {
    if (!source_) {
        return Status::InvalidArgument;
    }
    if (position > source_->size()) {
        return Status::OutOfRange;
    }
    position_ = position;
    windowStart_ = 0;
    windowEnd_ = 0;
    return Status::Ok;
}

Status ByteSourceReader::skip(std::size_t amount) noexcept {
    return seek(position_ + amount);
}

std::size_t ByteSourceReader::remaining() const noexcept {
    if (!source_) {
        return 0;
    }
    return source_->size() - position_;
}

Status ByteSourceReader::ensure(std::size_t amount) noexcept {
    if (amount == 0) {
        return Status::Ok;
    }
    if (!source_) {
        return Status::InvalidArgument;
    }
    if (position_ + amount > source_->size()) {
        return Status::Truncated;
    }

    if (position_ >= windowStart_ && position_ + amount <= windowEnd_) {
        return Status::Ok;
    }

    const std::size_t remaining = source_->size() - position_;
    const std::size_t toRead = (window_.size() < remaining) ? window_.size() : remaining;
    if (toRead == 0) {
        windowStart_ = position_;
        windowEnd_ = position_;
        return Status::Ok;
    }

    const Status s = source_->readInto(position_, Span<u8>(window_.data(), toRead));
    if (!ok(s)) {
        return s;
    }
    windowStart_ = position_;
    windowEnd_ = position_ + toRead;
    return Status::Ok;
}

Status ByteSourceReader::peekByte(i8* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    const Status s = ensure(1);
    if (!ok(s)) {
        return s;
    }
    const u8 value = window_[position_ - windowStart_];
    *out = static_cast<i8>(value);
    return Status::Ok;
}

Status ByteSourceReader::peekUnsignedByte(u8* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    i8 v = 0;
    const Status s = peekByte(&v);
    if (!ok(s)) {
        return s;
    }
    *out = static_cast<u8>(v);
    return Status::Ok;
}

Status ByteSourceReader::readByte(i8* out) noexcept {
    const Status s = peekByte(out);
    if (!ok(s)) {
        return s;
    }
    position_ += 1;
    return Status::Ok;
}

Status ByteSourceReader::readUnsignedByte(u8* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    i8 v = 0;
    const Status s = readByte(&v);
    if (!ok(s)) {
        return s;
    }
    *out = static_cast<u8>(v);
    return Status::Ok;
}

Status ByteSourceReader::readShort(i16* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    u8 a = 0;
    u8 b = 0;
    Status s = readUnsignedByte(&a);
    if (!ok(s)) {
        return s;
    }
    s = readUnsignedByte(&b);
    if (!ok(s)) {
        return s;
    }
    const u16 v = (static_cast<u16>(a) << 8) | static_cast<u16>(b);
    *out = static_cast<i16>(v);
    return Status::Ok;
}

Status ByteSourceReader::readUnsignedShort(u16* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    i16 v = 0;
    const Status s = readShort(&v);
    if (!ok(s)) {
        return s;
    }
    *out = static_cast<u16>(v);
    return Status::Ok;
}

Status ByteSourceReader::readMedium(u32* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    const Status s = ensure(3);
    if (!ok(s)) {
        return s;
    }
    const std::size_t off = position_ - windowStart_;
    const u32 value = readU24BE(window_.data() + off);
    position_ += 3;
    *out = value;
    return Status::Ok;
}

Status ByteSourceReader::readInt(i32* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    const Status s = ensure(4);
    if (!ok(s)) {
        return s;
    }
    const std::size_t off = position_ - windowStart_;
    const i32 value = readI32BE(window_.data() + off);
    position_ += 4;
    *out = value;
    return Status::Ok;
}

Status ByteSourceReader::readUnsignedInt(u32* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    const Status s = ensure(4);
    if (!ok(s)) {
        return s;
    }
    const std::size_t off = position_ - windowStart_;
    const u32 value = readU32BE(window_.data() + off);
    position_ += 4;
    *out = value;
    return Status::Ok;
}

Status ByteSourceReader::readBigSmart(i32* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    i8 b = 0;
    Status s = peekByte(&b);
    if (!ok(s)) {
        return s;
    }
    if (b < 0) {
        i32 v = 0;
        s = readInt(&v);
        if (!ok(s)) {
            return s;
        }
        *out = v & 0x7fffffff;
        return Status::Ok;
    }
    u16 v = 0;
    s = readUnsignedShort(&v);
    if (!ok(s)) {
        return s;
    }
    if (v == 32767) {
        *out = -1;
    } else {
        *out = static_cast<i32>(v);
    }
    return Status::Ok;
}

Status ByteSourceReader::readBytes(std::size_t amount, Span<const u8>* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    if (amount == 0) {
        owned_.clear();
        *out = Span<const u8>();
        return Status::Ok;
    }
    if (!source_) {
        return Status::InvalidArgument;
    }
    if (position_ + amount > source_->size()) {
        return Status::Truncated;
    }

    // Fast path: bytes entirely within current window.
    if (position_ >= windowStart_ && position_ + amount <= windowEnd_) {
        const std::size_t off = position_ - windowStart_;
        position_ += amount;
        *out = Span<const u8>(window_.data() + off, amount);
        return Status::Ok;
    }

    auto r = owned_.resize(amount);
    if (!r.isOk()) {
        return r.status();
    }
    const Status s = source_->readInto(position_, Span<u8>(owned_.data(), owned_.size()));
    if (!ok(s)) {
        return s;
    }
    position_ += amount;
    *out = Span<const u8>(owned_.data(), owned_.size());
    return Status::Ok;
}

Status ByteSourceReader::readBytesInto(Span<u8> target) noexcept {
    if (!target.data() && target.size() != 0) {
        return Status::InvalidArgument;
    }
    if (!source_) {
        return Status::InvalidArgument;
    }
    if (position_ + target.size() > source_->size()) {
        return Status::Truncated;
    }
    if (target.size() == 0) {
        return Status::Ok;
    }

    // Fast path: entirely within current window.
    if (position_ >= windowStart_ && position_ + target.size() <= windowEnd_) {
        const std::size_t off = position_ - windowStart_;
        std::memcpy(target.data(), window_.data() + off, target.size());
        position_ += target.size();
        return Status::Ok;
    }

    const Status s = source_->readInto(position_, target);
    if (!ok(s)) {
        return s;
    }
    position_ += target.size();
    return Status::Ok;
}

} // namespace rs
