#include "Uint8ArrayReader.hpp"

#include <cstring>

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../io/Endian.hpp"
#include "../types.hpp"

namespace rs {

Uint8ArrayReader::Uint8ArrayReader(Span<const u8> data, std::size_t offset) noexcept : data_(data), offset_(offset) {
    if (offset_ > data_.size()) {
        offset_ = data_.size();
    }
}

Status Uint8ArrayReader::ensure(std::size_t amount) const noexcept {
    if (amount == 0) {
        return Status::Ok;
    }
    if (offset_ > data_.size() || amount > data_.size() - offset_) {
        return Status::Truncated;
    }
    return Status::Ok;
}

Status Uint8ArrayReader::seek(std::size_t position) noexcept {
    if (position > data_.size()) {
        return Status::OutOfRange;
    }
    offset_ = position;
    return Status::Ok;
}

Status Uint8ArrayReader::skip(std::size_t amount) noexcept {
    return seek(offset_ + amount);
}

std::size_t Uint8ArrayReader::remaining() const noexcept {
    return data_.size() - offset_;
}

Status Uint8ArrayReader::peekByte(i8* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    const Status s = ensure(1);
    if (!ok(s)) {
        return s;
    }
    *out = static_cast<i8>(data_[offset_]);
    return Status::Ok;
}

Status Uint8ArrayReader::peekUnsignedByte(u8* out) noexcept {
    i8 v = 0;
    const Status s = peekByte(&v);
    if (!ok(s)) {
        return s;
    }
    if (!out) {
        return Status::InvalidArgument;
    }
    *out = static_cast<u8>(v);
    return Status::Ok;
}

Status Uint8ArrayReader::readByte(i8* out) noexcept {
    const Status s = peekByte(out);
    if (!ok(s)) {
        return s;
    }
    offset_ += 1;
    return Status::Ok;
}

Status Uint8ArrayReader::readUnsignedByte(u8* out) noexcept {
    i8 v = 0;
    const Status s = readByte(&v);
    if (!ok(s)) {
        return s;
    }
    if (!out) {
        return Status::InvalidArgument;
    }
    *out = static_cast<u8>(v);
    return Status::Ok;
}

Status Uint8ArrayReader::readShort(i16* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    const Status s = ensure(2);
    if (!ok(s)) {
        return s;
    }
    const u16 v = readU16BE(data_.data() + offset_);
    offset_ += 2;
    *out = static_cast<i16>(v);
    return Status::Ok;
}

Status Uint8ArrayReader::readUnsignedShort(u16* out) noexcept {
    i16 v = 0;
    const Status s = readShort(&v);
    if (!ok(s)) {
        return s;
    }
    if (!out) {
        return Status::InvalidArgument;
    }
    *out = static_cast<u16>(v);
    return Status::Ok;
}

Status Uint8ArrayReader::readMedium(u32* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    const Status s = ensure(3);
    if (!ok(s)) {
        return s;
    }
    const u32 v = readU24BE(data_.data() + offset_);
    offset_ += 3;
    *out = v;
    return Status::Ok;
}

Status Uint8ArrayReader::readInt(i32* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    const Status s = ensure(4);
    if (!ok(s)) {
        return s;
    }
    const i32 v = readI32BE(data_.data() + offset_);
    offset_ += 4;
    *out = v;
    return Status::Ok;
}

Status Uint8ArrayReader::readUnsignedInt(u32* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    const Status s = ensure(4);
    if (!ok(s)) {
        return s;
    }
    const u32 v = readU32BE(data_.data() + offset_);
    offset_ += 4;
    *out = v;
    return Status::Ok;
}

Status Uint8ArrayReader::readBigSmart(i32* out) noexcept {
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

Status Uint8ArrayReader::readBytes(std::size_t amount, Span<const u8>* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    const Status s = ensure(amount);
    if (!ok(s)) {
        return s;
    }
    const std::size_t start = offset_;
    offset_ += amount;
    *out = data_.subspan(start, amount);
    return Status::Ok;
}

Status Uint8ArrayReader::readBytesInto(Span<u8> target) noexcept {
    if (!target.data() && target.size() != 0) {
        return Status::InvalidArgument;
    }
    const Status s = ensure(target.size());
    if (!ok(s)) {
        return s;
    }
    if (target.size() == 0) {
        return Status::Ok;
    }
    std::memcpy(target.data(), data_.data() + offset_, target.size());
    offset_ += target.size();
    return Status::Ok;
}

Status Uint8ArrayReader::readBytesUntil(u8 terminator, Span<const u8>* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }

    const std::size_t start = offset_;
    while (true) {
        const Status s = ensure(1);
        if (!ok(s)) {
            return s;
        }
        const u8 b = data_[offset_];
        offset_ += 1;
        if (b == terminator) {
            const std::size_t endExcl = offset_ - 1;
            *out = data_.subspan(start, endExcl - start);
            return Status::Ok;
        }
    }
}

} // namespace rs
