#pragma once

#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"

namespace rs {

// Port of `src/rs/util/HeightCalc.ts` (Java-ish integer semantics).
// Used by terrain decoding when the encoded height is missing (v==0 on level 0).
class HeightCalc final {
public:
    // Deterministic cosine table used by HeightCalc interpolation.
    // Values are `trunc(65536 * cos(i * 2pi / 2048))`.
    static Span<const i32> cosine65536() noexcept;

    static i32 generateHeight(i32 x, i32 y) noexcept;
};

} // namespace rs

