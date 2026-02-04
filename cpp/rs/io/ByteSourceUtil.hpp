#pragma once

#include <cstddef>

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Vec.hpp"
#include "ByteSource.hpp"

namespace rs {

[[nodiscard]] inline Result<Vec<u8>> readAllBytes(const ByteSource& source, Allocator& alloc) noexcept {
    Vec<u8> out(alloc);
    const std::size_t n = source.size();
    auto r = out.resize(n);
    if (!r.isOk()) {
        return Result<Vec<u8>>::err(r.status());
    }
    if (n) {
        const Status s = source.readInto(0, Span<u8>(out.data(), out.size()));
        if (!ok(s)) {
            return Result<Vec<u8>>::err(s);
        }
    }
    return Result<Vec<u8>>::ok(rs::move(out));
}

} // namespace rs

