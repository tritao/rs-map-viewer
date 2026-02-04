#pragma once

#include <cstddef>
#include <span>

#include "ByteReader.hpp"
#include "Endian.hpp"

namespace rs {

class Uint8ArrayReader final : public ByteReader {
public:
    explicit Uint8ArrayReader(std::span<const u8> data, std::size_t offset = 0);

    [[nodiscard]] std::size_t tell() const override { return offset_; }
    void seek(std::size_t position) override;
    void skip(std::size_t amount) override;

    [[nodiscard]] std::size_t remaining() const override;

    [[nodiscard]] i8 peekByte() override;
    [[nodiscard]] u8 peekUnsignedByte() override;

    [[nodiscard]] i8 readByte() override;
    [[nodiscard]] u8 readUnsignedByte() override;
    [[nodiscard]] i16 readShort() override;
    [[nodiscard]] u16 readUnsignedShort() override;
    [[nodiscard]] u32 readMedium() override;
    [[nodiscard]] i32 readInt() override;
    [[nodiscard]] u32 readUnsignedInt() override;

    [[nodiscard]] i32 readBigSmart() override;

    [[nodiscard]] std::span<const u8> readBytes(std::size_t amount) override;

private:
    std::span<const u8> data_;
    std::size_t offset_;

    void ensure(std::size_t amount) const;
};

} // namespace rs

