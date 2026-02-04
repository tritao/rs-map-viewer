#pragma once

#include <cstddef>

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "ByteSource.hpp"
#include "Endian.hpp"

namespace rs {

class ByteSourceReader final {
public:
    explicit ByteSourceReader(const ByteSource* source, std::size_t windowSize = 4096);

    [[nodiscard]] std::size_t tell() const noexcept { return position_; }
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
    const ByteSource* source_ = nullptr;
    std::size_t position_ = 0;

    std::size_t windowStart_ = 0;
    std::size_t windowEnd_ = 0;
    Vec<u8> window_;

    Vec<u8> owned_;

    Status ensure(std::size_t amount) noexcept;
};

} // namespace rs
