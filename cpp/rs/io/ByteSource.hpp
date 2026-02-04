#pragma once

#include <cstddef>

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"

namespace rs {

class ByteSource;

class ByteSource {
public:
    virtual ~ByteSource() = default;

    [[nodiscard]] virtual std::size_t size() const noexcept = 0;
    virtual Status readInto(std::size_t offset, Span<u8> target) const noexcept = 0;

    // If the source is backed by a stable, contiguous byte region, return a view of the entire source.
    // This is a best-effort optimization; returning false is always allowed.
    [[nodiscard]] virtual bool tryGetView(Span<const u8>* out) const noexcept = 0;
};

} // namespace rs
