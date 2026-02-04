#pragma once

#include <cstddef>
#include <memory>
#include <span>
#include <vector>

#include "ByteReader.hpp"
#include "ByteSource.hpp"
#include "Endian.hpp"

namespace rs {

class ByteSourceReader final : public ByteReader {
public:
    explicit ByteSourceReader(ByteSourcePtr source, std::size_t windowSize = 4096);

    [[nodiscard]] std::size_t tell() const override { return position_; }
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
    void readBytesInto(u8* target, std::size_t length) override;

private:
    ByteSourcePtr source_;
    std::size_t position_ = 0;

    std::size_t windowStart_ = 0;
    std::size_t windowEnd_ = 0;
    std::vector<u8> window_;

    std::vector<u8> owned_;

    void ensure(std::size_t amount);
};

} // namespace rs
