#pragma once

#include <cstddef>

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "ByteSource.hpp"

namespace rs {

class ByteSourceSlice final : public ByteSource {
public:
    ByteSourceSlice(const ByteSource* source, std::size_t start, std::size_t size) noexcept;

    [[nodiscard]] std::size_t size() const noexcept override { return size_; }
    Status readInto(std::size_t offset, Span<u8> target) const noexcept override;
    [[nodiscard]] bool tryGetView(Span<const u8>* out) const noexcept override;

private:
    const ByteSource* source_ = nullptr;
    std::size_t start_;
    std::size_t size_;
};

} // namespace rs
