#include "Uint8ArrayReader.hpp"

#include <cstring>
#include <span>
#include <stdexcept>

#include "Endian.hpp"
#include "../types.hpp"

namespace rs {

Uint8ArrayReader::Uint8ArrayReader(std::span<const u8> data, std::size_t offset) : data_(data), offset_(offset) {
    if (offset_ > data_.size()) {
        throw std::out_of_range("Uint8ArrayReader: invalid initial offset");
    }
}

void Uint8ArrayReader::ensure(std::size_t amount) const {
    if (amount == 0) {
        return;
    }
    if (offset_ > data_.size() || amount > data_.size() - offset_) {
        throw std::out_of_range("Uint8ArrayReader: truncated");
    }
}

void Uint8ArrayReader::seek(std::size_t position) {
    if (position > data_.size()) {
        throw std::out_of_range("Uint8ArrayReader: seek out of bounds");
    }
    offset_ = position;
}

void Uint8ArrayReader::skip(std::size_t amount) {
    seek(offset_ + amount);
}

std::size_t Uint8ArrayReader::remaining() const {
    return data_.size() - offset_;
}

i8 Uint8ArrayReader::peekByte() {
    ensure(1);
    return static_cast<i8>(data_[offset_]);
}

u8 Uint8ArrayReader::peekUnsignedByte() {
    return static_cast<u8>(peekByte());
}

i8 Uint8ArrayReader::readByte() {
    const i8 v = peekByte();
    offset_ += 1;
    return v;
}

u8 Uint8ArrayReader::readUnsignedByte() {
    return static_cast<u8>(readByte());
}

i16 Uint8ArrayReader::readShort() {
    ensure(2);
    const u16 v = readU16BE(data_.data() + offset_);
    offset_ += 2;
    return static_cast<i16>(v);
}

u16 Uint8ArrayReader::readUnsignedShort() {
    return static_cast<u16>(readShort());
}

u32 Uint8ArrayReader::readMedium() {
    ensure(3);
    const u32 v = readU24BE(data_.data() + offset_);
    offset_ += 3;
    return v;
}

i32 Uint8ArrayReader::readInt() {
    ensure(4);
    const i32 v = readI32BE(data_.data() + offset_);
    offset_ += 4;
    return v;
}

u32 Uint8ArrayReader::readUnsignedInt() {
    ensure(4);
    const u32 v = readU32BE(data_.data() + offset_);
    offset_ += 4;
    return v;
}

i32 Uint8ArrayReader::readBigSmart() {
    if (peekByte() < 0) {
        return static_cast<i32>(readInt() & 0x7fffffff);
    }
    const u16 v = readUnsignedShort();
    if (v == 32767) {
        return -1;
    }
    return static_cast<i32>(v);
}

std::span<const u8> Uint8ArrayReader::readBytes(std::size_t amount) {
    ensure(amount);
    const std::size_t start = offset_;
    offset_ += amount;
    return data_.subspan(start, amount);
}

void Uint8ArrayReader::readBytesInto(u8* target, std::size_t length) {
    if (!target && length != 0) {
        throw std::invalid_argument("Uint8ArrayReader: target is null");
    }
    ensure(length);
    if (length == 0) {
        return;
    }
    std::memcpy(target, data_.data() + offset_, length);
    offset_ += length;
}

} // namespace rs
