#pragma once

#include <cstddef>

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"

namespace rs {

struct XteaKey {
    u32 k[4];
};

class Xtea {
public:
    static constexpr i32 GOLDEN_RATIO = static_cast<i32>(0x9e3779b9u);
    static constexpr int ROUNDS = 32;

    static bool isValidKey(const XteaKey* key) noexcept;

    static Status decryptInPlace(Span<u8> data, std::size_t start, std::size_t end, const XteaKey& key) noexcept;
};

} // namespace rs
