#pragma once

#include <memory>
#include <span>
#include <vector>

#include "ByteSourceSlice.hpp"

namespace rs {

class Uint8ArrayByteSource final : public ByteSource {
public:
    explicit Uint8ArrayByteSource(std::shared_ptr<std::vector<u8>> bytes);

    [[nodiscard]] std::size_t size() const override;
    [[nodiscard]] ByteSourcePtr slice(std::size_t start, std::size_t size) const override;
    void readInto(std::size_t offset, u8* target, std::size_t length) const override;
    [[nodiscard]] std::optional<std::span<const u8>> tryGetUint8ArrayView() const override;

private:
    std::shared_ptr<std::vector<u8>> bytes_;
};

} // namespace rs
