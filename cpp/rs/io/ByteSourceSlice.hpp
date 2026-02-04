#pragma once

#include "ByteSource.hpp"

namespace rs {

class ByteSourceSlice final : public ByteSource {
public:
    ByteSourceSlice(ByteSourcePtr source, std::size_t start, std::size_t size);

    [[nodiscard]] std::size_t size() const override { return size_; }
    [[nodiscard]] ByteSourcePtr slice(std::size_t start, std::size_t size) const override;
    void readInto(std::size_t offset, u8* target, std::size_t length) const override;
    [[nodiscard]] std::optional<std::span<const u8>> tryGetUint8ArrayView() const override;

private:
    ByteSourcePtr source_;
    std::size_t start_;
    std::size_t size_;
};

} // namespace rs

