#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

enum class ArithmeticBlendMode : u8 {
    Add = 1,
    Subtract = 2,
    Multiply = 3,
    Divide = 4,
    Screen = 5,
    Overlay = 6,
    ColorDodge = 7,
    ColorBurn = 8,
    Min = 9,
    Max = 10,
    Difference = 11,
    Exclusion = 12,
};

static inline i32 minI32(i32 a, i32 b) noexcept { return a < b ? a : b; }
static inline i32 maxI32(i32 a, i32 b) noexcept { return a > b ? a : b; }

class ArithmeticOperation final : public TextureOperationImpl<ArithmeticOperation> {
public:
    ArithmeticOperation() noexcept : TextureOperationImpl(2, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            blendMode_ = static_cast<ArithmeticBlendMode>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            setIsMonochrome(v == 1);
            return Status::Ok;
        }
        return Status::Ok;
    }

    Status getMonochromeOutput(TextureGenerator& textureGenerator, i32 line, Span<i32>* out) noexcept override {
        if (!out) {
            return Status::InvalidArgument;
        }
        Span<i32> lineOut = monochromeCache().get(line);
        if (lineOut.size() == 0) {
            *out = lineOut;
            return Status::OutOfRange;
        }
        if (monochromeCache().dirty()) {
            Span<i32> inputA;
            Span<i32> inputB;
            Status s = getMonochromeInput(textureGenerator, 0, line, &inputA);
            if (!ok(s)) {
                return s;
            }
            s = getMonochromeInput(textureGenerator, 1, line, &inputB);
            if (!ok(s)) {
                return s;
            }

            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            switch (blendMode_) {
            case ArithmeticBlendMode::Add:
                for (std::size_t i = 0; i < w; i++) {
                    lineOut[i] = javaAdd(inputA[i], inputB[i]);
                }
                break;
            case ArithmeticBlendMode::Subtract:
                for (std::size_t i = 0; i < w; i++) {
                    lineOut[i] = javaSub(inputA[i], inputB[i]);
                }
                break;
            case ArithmeticBlendMode::Multiply:
                for (std::size_t i = 0; i < w; i++) {
                    lineOut[i] = javaMulQ12(inputB[i], inputA[i]);
                }
                break;
            case ArithmeticBlendMode::Divide:
                for (std::size_t i = 0; i < w; i++) {
                    const i32 b = inputB[i];
                    lineOut[i] =
                        (b == 0) ? 4096 : javaDivQ12(inputA[i], b);
                }
                break;
            case ArithmeticBlendMode::Screen:
                for (std::size_t i = 0; i < w; i++) {
                    lineOut[i] = static_cast<i32>(
                        4096 - javaMulQ12(static_cast<i32>(4096 - inputA[i]), static_cast<i32>(4096 - inputB[i])));
                }
                break;
            case ArithmeticBlendMode::Overlay:
                for (std::size_t i = 0; i < w; i++) {
                    const i32 b = inputB[i];
                    lineOut[i] = (b >= 2048)
                        ? static_cast<i32>(
                              4096 -
                              javaMulShift(static_cast<i32>(4096 - inputA[i]), static_cast<i32>(4096 - b), 11))
                        : javaMulShift(inputA[i], b, 11);
                }
                break;
            case ArithmeticBlendMode::ColorDodge:
                for (std::size_t i = 0; i < w; i++) {
                    const i32 a = inputA[i];
                    lineOut[i] = (a == 4096)
                        ? 4096
                        : javaIDiv(javaShl(inputB[i], 12), static_cast<i32>(4096 - a));
                }
                break;
            case ArithmeticBlendMode::ColorBurn:
                for (std::size_t i = 0; i < w; i++) {
                    const i32 a = inputA[i];
                    lineOut[i] = (a == 0)
                        ? 0
                        : static_cast<i32>(4096 - javaIDiv(javaShl(static_cast<i32>(4096 - inputB[i]), 12), a));
                }
                break;
            case ArithmeticBlendMode::Min:
                for (std::size_t i = 0; i < w; i++) {
                    lineOut[i] = minI32(inputA[i], inputB[i]);
                }
                break;
            case ArithmeticBlendMode::Max:
                for (std::size_t i = 0; i < w; i++) {
                    lineOut[i] = maxI32(inputA[i], inputB[i]);
                }
                break;
            case ArithmeticBlendMode::Difference:
                for (std::size_t i = 0; i < w; i++) {
                    const i32 a = inputA[i];
                    const i32 b = inputB[i];
                    lineOut[i] = (b < a)
                        ? javaSub(a, b)
                        : javaSub(b, a);
                }
                break;
            case ArithmeticBlendMode::Exclusion:
                for (std::size_t i = 0; i < w; i++) {
                    const i32 a = inputA[i];
                    const i32 b = inputB[i];
                    lineOut[i] = static_cast<i32>(javaSub(javaAdd(a, b), javaMulShift(a, b, 11)));
                }
                break;
            default:
                return Status::Unsupported;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

    Status getColourOutput(TextureGenerator& textureGenerator, i32 line, ColourLine* out) noexcept override {
        if (!out) {
            return Status::InvalidArgument;
        }
        ColourLine lineOut = colourCache().get(line);
        if (lineOut.r.size() == 0) {
            *out = lineOut;
            return Status::OutOfRange;
        }
        if (colourCache().dirty()) {
            ColourLine inputA{};
            ColourLine inputB{};
            Status s = getColourInput(textureGenerator, 0, line, &inputA);
            if (!ok(s)) {
                return s;
            }
            s = getColourInput(textureGenerator, 1, line, &inputB);
            if (!ok(s)) {
                return s;
            }

            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            switch (blendMode_) {
            case ArithmeticBlendMode::Add:
                for (std::size_t i = 0; i < w; i++) {
                    lineOut.r[i] = javaAdd(inputA.r[i], inputB.r[i]);
                    lineOut.g[i] = javaAdd(inputA.g[i], inputB.g[i]);
                    lineOut.b[i] = javaAdd(inputA.b[i], inputB.b[i]);
                }
                break;
            case ArithmeticBlendMode::Subtract:
                for (std::size_t i = 0; i < w; i++) {
                    lineOut.r[i] = javaSub(inputA.r[i], inputB.r[i]);
                    lineOut.g[i] = javaSub(inputA.g[i], inputB.g[i]);
                    lineOut.b[i] = javaSub(inputA.b[i], inputB.b[i]);
                }
                break;
            case ArithmeticBlendMode::Multiply:
                for (std::size_t i = 0; i < w; i++) {
                    lineOut.r[i] = javaMulQ12(inputB.r[i], inputA.r[i]);
                    lineOut.g[i] = javaMulQ12(inputB.g[i], inputA.g[i]);
                    lineOut.b[i] = javaMulQ12(inputB.b[i], inputA.b[i]);
                }
                break;
            case ArithmeticBlendMode::Divide:
                for (std::size_t i = 0; i < w; i++) {
                    const i32 bR = inputB.r[i];
                    const i32 bG = inputB.g[i];
                    const i32 bB = inputB.b[i];
                    lineOut.r[i] = (bR == 0) ? 4096 : javaDivQ12(inputA.r[i], bR);
                    lineOut.g[i] = (bG == 0) ? 4096 : javaDivQ12(inputA.g[i], bG);
                    lineOut.b[i] = (bB == 0) ? 4096 : javaDivQ12(inputA.b[i], bB);
                }
                break;
            case ArithmeticBlendMode::Screen:
                for (std::size_t i = 0; i < w; i++) {
                    lineOut.r[i] = static_cast<i32>(
                        4096 -
                        javaMulQ12(static_cast<i32>(4096 - inputA.r[i]), static_cast<i32>(4096 - inputB.r[i])));
                    lineOut.g[i] = static_cast<i32>(
                        4096 -
                        javaMulQ12(static_cast<i32>(4096 - inputA.g[i]), static_cast<i32>(4096 - inputB.g[i])));
                    lineOut.b[i] = static_cast<i32>(
                        4096 -
                        javaMulQ12(static_cast<i32>(4096 - inputA.b[i]), static_cast<i32>(4096 - inputB.b[i])));
                }
                break;
            case ArithmeticBlendMode::Overlay:
                for (std::size_t i = 0; i < w; i++) {
                    const i32 bR = inputB.r[i];
                    const i32 bG = inputB.g[i];
                    const i32 bB = inputB.b[i];
                    lineOut.r[i] = (bR >= 2048)
                        ? static_cast<i32>(
                              4096 -
                              javaMulShift(static_cast<i32>(4096 - inputA.r[i]), static_cast<i32>(4096 - bR), 11))
                        : javaMulShift(inputA.r[i], bR, 11);
                    lineOut.g[i] = (bG >= 2048)
                        ? static_cast<i32>(
                              4096 -
                              javaMulShift(static_cast<i32>(4096 - inputA.g[i]), static_cast<i32>(4096 - bG), 11))
                        : javaMulShift(inputA.g[i], bG, 11);
                    lineOut.b[i] = (bB >= 2048)
                        ? static_cast<i32>(
                              4096 -
                              javaMulShift(static_cast<i32>(4096 - inputA.b[i]), static_cast<i32>(4096 - bB), 11))
                        : javaMulShift(inputA.b[i], bB, 11);
                }
                break;
            case ArithmeticBlendMode::ColorDodge:
                for (std::size_t i = 0; i < w; i++) {
                    const i32 aR = inputA.r[i];
                    const i32 aG = inputA.g[i];
                    const i32 aB = inputA.b[i];
                    lineOut.r[i] = (aR == 4096)
                        ? 4096
                        : javaIDiv(javaShl(inputB.r[i], 12), static_cast<i32>(4096 - aR));
                    lineOut.g[i] = (aG == 4096)
                        ? 4096
                        : javaIDiv(javaShl(inputB.g[i], 12), static_cast<i32>(4096 - aG));
                    lineOut.b[i] = (aB == 4096)
                        ? 4096
                        : javaIDiv(javaShl(inputB.b[i], 12), static_cast<i32>(4096 - aB));
                }
                break;
            case ArithmeticBlendMode::ColorBurn:
                for (std::size_t i = 0; i < w; i++) {
                    const i32 aR = inputA.r[i];
                    const i32 aG = inputA.g[i];
                    const i32 aB = inputA.b[i];
                    lineOut.r[i] = (aR == 0)
                        ? 0
                        : static_cast<i32>(
                              4096 -
                              javaIDiv(javaShl(static_cast<i32>(4096 - inputB.r[i]), 12), aR));
                    lineOut.g[i] = (aG == 0)
                        ? 0
                        : static_cast<i32>(
                              4096 -
                              javaIDiv(javaShl(static_cast<i32>(4096 - inputB.g[i]), 12), aG));
                    lineOut.b[i] = (aB == 0)
                        ? 0
                        : static_cast<i32>(
                              4096 -
                              javaIDiv(javaShl(static_cast<i32>(4096 - inputB.b[i]), 12), aB));
                }
                break;
            case ArithmeticBlendMode::Min:
                for (std::size_t i = 0; i < w; i++) {
                    lineOut.r[i] = minI32(inputA.r[i], inputB.r[i]);
                    lineOut.g[i] = minI32(inputA.g[i], inputB.g[i]);
                    lineOut.b[i] = minI32(inputA.b[i], inputB.b[i]);
                }
                break;
            case ArithmeticBlendMode::Max:
                for (std::size_t i = 0; i < w; i++) {
                    lineOut.r[i] = maxI32(inputA.r[i], inputB.r[i]);
                    lineOut.g[i] = maxI32(inputA.g[i], inputB.g[i]);
                    lineOut.b[i] = maxI32(inputA.b[i], inputB.b[i]);
                }
                break;
            case ArithmeticBlendMode::Difference:
                for (std::size_t i = 0; i < w; i++) {
                    const i32 aR = inputA.r[i];
                    const i32 aG = inputA.g[i];
                    const i32 aB = inputA.b[i];
                    const i32 bR = inputB.r[i];
                    const i32 bG = inputB.g[i];
                    const i32 bB = inputB.b[i];
                    lineOut.r[i] = (bR < aR)
                        ? javaSub(aR, bR)
                        : javaSub(bR, aR);
                    lineOut.g[i] = (bG < aG)
                        ? javaSub(aG, bG)
                        : javaSub(bG, aG);
                    lineOut.b[i] = (bB < aB)
                        ? javaSub(aB, bB)
                        : javaSub(bB, aB);
                }
                break;
            case ArithmeticBlendMode::Exclusion:
                for (std::size_t i = 0; i < w; i++) {
                    const i32 aR = inputA.r[i];
                    const i32 aG = inputA.g[i];
                    const i32 aB = inputA.b[i];
                    const i32 bR = inputB.r[i];
                    const i32 bG = inputB.g[i];
                    const i32 bB = inputB.b[i];
                    lineOut.r[i] = static_cast<i32>(javaSub(javaAdd(aR, bR), javaMulShift(aR, bR, 11)));
                    lineOut.g[i] = static_cast<i32>(javaSub(javaAdd(aG, bG), javaMulShift(aG, bG, 11)));
                    lineOut.b[i] = static_cast<i32>(javaSub(javaAdd(aB, bB), javaMulShift(aB, bB, 11)));
                }
                break;
            default:
                return Status::Unsupported;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    ArithmeticBlendMode blendMode_ = ArithmeticBlendMode::Overlay;
};

} // namespace rs
