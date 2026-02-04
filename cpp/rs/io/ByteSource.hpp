#pragma once

#include <cstddef>
#include <memory>
#include <optional>
#include <span>

#include "../types.hpp"

namespace rs {

class ByteSource;
using ByteSourcePtr = std::shared_ptr<const ByteSource>;

class ByteSource {
public:
    virtual ~ByteSource() = default;

    [[nodiscard]] virtual std::size_t size() const = 0;
    [[nodiscard]] virtual ByteSourcePtr slice(std::size_t start, std::size_t size) const = 0;

    virtual void readInto(std::size_t offset, u8* target, std::size_t length) const = 0;

    [[nodiscard]] virtual std::optional<std::span<const u8>> tryGetUint8ArrayView() const = 0;
};

} // namespace rs

