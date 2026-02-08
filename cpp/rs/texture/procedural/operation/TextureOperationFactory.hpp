#pragma once

#include "../../../core/Allocator.hpp"
#include "../../../core/Result.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "TextureOperation.hpp"

namespace rs {

// Mirrors `TextureOperationTypeId` in TS.
enum class TextureOperationTypeId : u8 {
    ConstantMonochrome = 0,
    ConstantColour = 1,
    HorizontalGradient = 2,
    VerticalGradient = 3,
    Bricks = 4,
    Blur = 5,
    Clamp = 6,
    Arithmetic = 7,
    Curve = 8,
    Mirror = 9,
    Gradient = 10,
    ColourStrip = 11,
    DiagonalGradient = 12,
    PseudoRandomNoise = 13,
    Weave = 14,
    VoronoiNoise = 15,
    Herringbone = 16,
    Hsl = 17,
    TilingSprite = 18,
    TrigWarp = 19,
    Tiling = 20,
    Lerp = 21,
    Invert = 22,
    Kaleidoscope = 23,
    GrayScale = 24,
    Brightness = 25,
    RangeThreshold = 26,
    SquareWaveform = 27,
    IrregularBricks = 28,
    ShapeRasterizer = 29,
    Range = 30,
    Mandelbrot = 31,
    Emboss = 32,
    NormalMap = 33,
    PerlinNoise = 34,
    MonochromeEdgeDetector = 35,
    TextureSource = 36,
    WavyCross = 37,
    LineNoise = 38,
    SpriteSource = 39,
};

struct TextureOperationCreateResult final {
    TextureOperation* op = nullptr;
    i32 inputCount = 0;
};

// Creates an operation object and decodes its properties from the reader.
// The returned `inputs` array is not wired; the caller should call `setInputs` with pointers.
Result<TextureOperationCreateResult> createTextureOperation(Uint8ArrayReader& reader, Allocator& alloc) noexcept;

} // namespace rs
