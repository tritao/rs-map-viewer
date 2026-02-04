#pragma once

#include <cstddef>
#include <span>

#include "../types.hpp"

namespace rs {

class ByteReader {
public:
    virtual ~ByteReader() = default;

    [[nodiscard]] virtual std::size_t tell() const = 0;
    virtual void seek(std::size_t position) = 0;
    virtual void skip(std::size_t amount) = 0;

    [[nodiscard]] virtual std::size_t remaining() const = 0;

    [[nodiscard]] virtual i8 peekByte() = 0;
    [[nodiscard]] virtual u8 peekUnsignedByte() = 0;

    [[nodiscard]] virtual i8 readByte() = 0;
    [[nodiscard]] virtual u8 readUnsignedByte() = 0;
    [[nodiscard]] virtual i16 readShort() = 0;
    [[nodiscard]] virtual u16 readUnsignedShort() = 0;
    [[nodiscard]] virtual u32 readMedium() = 0;
    [[nodiscard]] virtual i32 readInt() = 0;
    [[nodiscard]] virtual u32 readUnsignedInt() = 0;

    [[nodiscard]] virtual i32 readBigSmart() = 0;

    [[nodiscard]] virtual std::span<const u8> readBytes(std::size_t amount) = 0;
};

} // namespace rs

