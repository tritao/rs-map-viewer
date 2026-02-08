#pragma once

#include <cstddef>

#include "../../core/Allocator.hpp"
#include "../../core/Result.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../types.hpp"
#include "ProceduralSources.hpp"

namespace rs {

// Minimal port of `src/rs/texture/procedural/TextureGenerator.ts`.
//
// This owns per-render tables (gradients, brightness LUTs, trig tables) and state like `isTransparent`.
// Caches/operations are per-texture, but they use this generator for shared tables and helpers.
class TextureGenerator final {
public:
    explicit TextureGenerator(Allocator& alloc) noexcept : alloc_(&alloc), horizontalGradient_(alloc), verticalGradient_(alloc) {}

    TextureGenerator() = default;

    [[nodiscard]] Allocator& allocator() noexcept { return alloc_ ? *alloc_ : defaultAllocator(); }

    Status init(i32 width, i32 height) noexcept;
    void initBrightness(float brightness) noexcept;

    // Tables shared across operations (mirrors TS exports in `TextureGenerator.ts`).
    [[nodiscard]] Span<const i32> sineTableQ12() const noexcept;
    [[nodiscard]] Span<const i32> cosineTableQ12() const noexcept;
    [[nodiscard]] Span<const i8> inverseSquareRootTable() const noexcept;

    // Returns a 512-length permutations table for the given seed (0..255), matching TS `createPermutations`.
    Status getPermutations(i32 seed, Span<const i8>* out) noexcept;

    void clearCache() noexcept {
        // Mirrors TS: clear permutation cache (not yet implemented) + reset brightness.
        clearPermutationCache();
        brightness_ = -1.0f;
    }

    [[nodiscard]] i32 width() const noexcept { return width_; }
    [[nodiscard]] i32 height() const noexcept { return height_; }
    [[nodiscard]] i32 widthMask() const noexcept { return widthMask_; }
    [[nodiscard]] i32 heightMask() const noexcept { return heightMask_; }
    [[nodiscard]] i32 widthTimes32() const noexcept { return widthTimes32_; }

    [[nodiscard]] Span<i32> horizontalGradient() noexcept { return horizontalGradient_.span(); }
    [[nodiscard]] Span<const i32> horizontalGradient() const noexcept { return horizontalGradient_.span(); }
    [[nodiscard]] Span<i32> verticalGradient() noexcept { return verticalGradient_.span(); }
    [[nodiscard]] Span<const i32> verticalGradient() const noexcept { return verticalGradient_.span(); }
    [[nodiscard]] Span<const i32> brightnessTable() const noexcept { return Span<const i32>(brightnessTable_, 256); }

    bool isTransparent = false;
    bool debug = false;

    const ISpriteSource* spriteSource = nullptr;
    const ITextureSource* textureSource = nullptr;

private:
    Allocator* alloc_ = nullptr;

    i32 width_ = 0;
    i32 height_ = 0;
    i32 widthTimes32_ = 0;
    i32 widthMask_ = 0;
    i32 heightMask_ = 0;

    Vec<i32> horizontalGradient_{};
    Vec<i32> verticalGradient_{};

    i32 brightnessTable_[256]{};
    float brightness_ = -1.0f;

    // Seed-specific permutations cache:
    // TS caches permutations by seed and never overwrites while in use. We do the same to avoid
    // returning spans into storage that can be overwritten by later getPermutations() calls.
    static constexpr std::size_t PERM_SEED_COUNT = 256;
    Vec<i8> permBySeedData_{};
    u8 permBySeedUsed_[PERM_SEED_COUNT]{};

    void clearPermutationCache() noexcept {
        for (std::size_t i = 0; i < PERM_SEED_COUNT; i++) {
            permBySeedUsed_[i] = 0;
        }
    }
};

} // namespace rs
