#pragma once

#include <cstddef>

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "Endian.hpp"

namespace rs {

class Uint8ArrayReader final {
public:
    explicit Uint8ArrayReader(Span<const u8> data, std::size_t offset = 0) noexcept;

    [[nodiscard]] std::size_t tell() const noexcept { return offset_; }
    Status seek(std::size_t position) noexcept;
    Status skip(std::size_t amount) noexcept;

    [[nodiscard]] std::size_t remaining() const noexcept;

    Status peekByte(i8* out) noexcept;
    Status peekUnsignedByte(u8* out) noexcept;

    Status readByte(i8* out) noexcept;
    Status readUnsignedByte(u8* out) noexcept;
    Status readShort(i16* out) noexcept;
    Status readUnsignedShort(u16* out) noexcept;
    Status readMedium(u32* out) noexcept;
    Status readInt(i32* out) noexcept;
    Status readUnsignedInt(u32* out) noexcept;

    Status readBigSmart(i32* out) noexcept;

    Status readBytes(std::size_t amount, Span<const u8>* out) noexcept;
    Status readBytesInto(Span<u8> target) noexcept;

private:
    Span<const u8> data_;
    std::size_t offset_;

    Status ensure(std::size_t amount) const noexcept;
};

} // namespace rs
