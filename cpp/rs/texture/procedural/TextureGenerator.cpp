#include "TextureGenerator.hpp"

#include <cmath>
#include <cstdint>

#include "../../types.hpp"
#include "../../util/JavaRandom.hpp"

namespace rs {

static inline i32 clampI32(i32 v, i32 lo, i32 hi) noexcept {
    if (v < lo) {
        return lo;
    }
    if (v > hi) {
        return hi;
    }
    return v;
}

static constexpr std::size_t TABLE_SINE_COSINE_SIZE = 256;
static constexpr std::size_t TABLE_INV_SQRT_SIZE = 32896;

static i32 g_sineQ12[TABLE_SINE_COSINE_SIZE]{};
static i32 g_cosineQ12[TABLE_SINE_COSINE_SIZE]{};
static i8 g_invSqrt[TABLE_INV_SQRT_SIZE]{};
static bool g_tablesReady = false;

static void ensureTables() noexcept {
    if (g_tablesReady) {
        return;
    }

    // Trig tables: 256 entries over [0, 2pi].
    for (i32 i = 0; i < 256; i++) {
        const double radians = (static_cast<double>(i) / 255.0) * 6.283185307179586;
        g_sineQ12[i] = static_cast<i32>(std::sin(radians) * 4096.0);
        g_cosineQ12[i] = static_cast<i32>(std::cos(radians) * 4096.0);
    }

    // Inverse-square-root table: mirrors TS `TEXTURE_INVERSE_SQUARE_ROOT_TABLE`.
    std::size_t idx = 0;
    for (i32 x = 0; x < 256; x++) {
        for (i32 y = 0; y <= x; y++) {
            const double num = 255.0;
            // TS uses `Math.fround(...)` before sqrt, so we round the ratio to float32 first.
            const double ratio = static_cast<double>(x * x + y * y + 65535) / 65535.0;
            const float ratioF = static_cast<float>(ratio);
            const double denom = std::sqrt(static_cast<double>(ratioF));
            const i32 v = static_cast<i32>(num / denom);
            if (idx < TABLE_INV_SQRT_SIZE) {
                g_invSqrt[idx++] = static_cast<i8>(v);
            }
        }
    }

    g_tablesReady = true;
}

static Status createPermutations(i32 seed, Span<i8> out) noexcept {
    if (out.size() < 512) {
        return Status::InvalidArgument;
    }
    JavaRandom random(static_cast<u64>(seed));

    for (i32 i = 0; i < 255; i++) {
        out[static_cast<std::size_t>(i)] = static_cast<i8>(i);
    }
    // The last element (index 255) is never initialized directly in TS; it gets a value via the shuffle.
    out[255] = 0;

    for (i32 i = 0; i < 255; i++) {
        const i32 index0 = 255 - i;
        const i32 index1 = nextIntJagex(random, index0);
        const i8 perm1 = out[static_cast<std::size_t>(index1)];
        out[static_cast<std::size_t>(index1)] = out[static_cast<std::size_t>(index0)];
        out[static_cast<std::size_t>(index0)] = perm1;
        out[static_cast<std::size_t>(511 - i)] = perm1;
    }
    // Mirror TS: permutations length 512, with [0..255] and [256..511] filled by the shuffle.
    return Status::Ok;
}

Status TextureGenerator::init(i32 width, i32 height) noexcept {
    if (!alloc_) {
        return Status::InvalidArgument;
    }
    if (width <= 0 || height <= 0) {
        return Status::InvalidArgument;
    }

    isTransparent = false;

    if (width_ != width) {
        auto rr = horizontalGradient_.resize(static_cast<std::size_t>(width));
        if (!rr.isOk()) {
            return rr.status();
        }
        for (i32 i = 0; i < width; i++) {
            // (i<<12)/width
            horizontalGradient_[static_cast<std::size_t>(i)] = (i << 12) / width;
        }
        widthMask_ = width - 1;
        width_ = width;
        widthTimes32_ = width * 32;
    }

    if (height_ != height) {
        auto rr = verticalGradient_.resize(static_cast<std::size_t>(height));
        if (!rr.isOk()) {
            return rr.status();
        }
        if (height == width_) {
            for (i32 i = 0; i < height; i++) {
                verticalGradient_[static_cast<std::size_t>(i)] = horizontalGradient_[static_cast<std::size_t>(i)];
            }
        } else {
            for (i32 i = 0; i < height; i++) {
                verticalGradient_[static_cast<std::size_t>(i)] = (i << 12) / height;
            }
        }
        heightMask_ = height - 1;
        height_ = height;
    }

    return Status::Ok;
}

void TextureGenerator::initBrightness(float brightness) noexcept {
    if (brightness_ == brightness) {
        return;
    }

    // Mirrors TS: v = (pow(i/255, brightness)*255) |0, then clamp to [0,255].
    for (i32 i = 0; i < 256; i++) {
        const double x = static_cast<double>(i) / 255.0;
        const double y = std::pow(x, static_cast<double>(brightness)) * 255.0;
        const i32 v = clampI32(static_cast<i32>(y), 0, 255);
        brightnessTable_[i] = v;
    }

    brightness_ = brightness;
}

Span<const i32> TextureGenerator::sineTableQ12() const noexcept {
    ensureTables();
    return Span<const i32>(g_sineQ12, TABLE_SINE_COSINE_SIZE);
}

Span<const i32> TextureGenerator::cosineTableQ12() const noexcept {
    ensureTables();
    return Span<const i32>(g_cosineQ12, TABLE_SINE_COSINE_SIZE);
}

Span<const i8> TextureGenerator::inverseSquareRootTable() const noexcept {
    ensureTables();
    return Span<const i8>(g_invSqrt, TABLE_INV_SQRT_SIZE);
}

Status TextureGenerator::getPermutations(i32 seed, Span<const i8>* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    *out = Span<const i8>(nullptr, 0);
    if (!alloc_) {
        return Status::InvalidArgument;
    }
    if (seed < 0 || seed > 255) {
        return Status::OutOfRange;
    }

    if (permBySeedData_.size() == 0) {
        permBySeedData_ = Vec<i8>(*alloc_);
        auto rr = permBySeedData_.resize(PERM_SEED_COUNT * 512);
        if (!rr.isOk()) {
            return rr.status();
        }
        for (std::size_t i = 0; i < permBySeedData_.size(); i++) {
            permBySeedData_[i] = 0;
        }
        for (std::size_t i = 0; i < PERM_SEED_COUNT; i++) {
            permBySeedUsed_[i] = 0;
        }
    }

    const std::size_t seedIdx = static_cast<std::size_t>(seed);
    const std::size_t base = seedIdx * 512;
    if (permBySeedUsed_[seedIdx] == 0) {
        Span<i8> dst(permBySeedData_.data() + base, 512);
        const Status s = createPermutations(seed, dst);
        if (!ok(s)) {
            return s;
        }
        permBySeedUsed_[seedIdx] = 1;
    }

    *out = Span<const i8>(permBySeedData_.data() + base, 512);
    return Status::Ok;
}

} // namespace rs
