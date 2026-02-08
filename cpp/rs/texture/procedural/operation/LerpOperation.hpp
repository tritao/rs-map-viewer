#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class LerpOperation final : public TextureOperationImpl<LerpOperation> {
public:
    LerpOperation() noexcept : TextureOperationImpl(3, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId != 0) {
            return Status::Ok;
        }
        u8 v = 0;
        const Status s = reader.readUnsignedByte(&v);
        if (!ok(s)) {
            return s;
        }
        setIsMonochrome(v == 1);
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
            Span<i32> inputC;
            Status s = getMonochromeInput(textureGenerator, 0, line, &inputA);
            if (!ok(s)) {
                return s;
            }
            s = getMonochromeInput(textureGenerator, 1, line, &inputB);
            if (!ok(s)) {
                return s;
            }
            s = getMonochromeInput(textureGenerator, 2, line, &inputC);
            if (!ok(s)) {
                return s;
            }
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                const i32 aWeight = inputC[i];
                if (aWeight == 4096) {
                    lineOut[i] = inputA[i];
                } else if (aWeight == 0) {
                    lineOut[i] = inputB[i];
                } else {
                    const i32 bWeight = javaSub(4096, aWeight);
                    lineOut[i] = javaShr(javaAdd(javaMul(bWeight, inputB[i]), javaMul(aWeight, inputA[i])), 12);
                }
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
            Span<i32> inputC;
            Status s = getMonochromeInput(textureGenerator, 2, line, &inputC);
            if (!ok(s)) {
                return s;
            }
            ColourLine inputA{};
            ColourLine inputB{};
            s = getColourInput(textureGenerator, 0, line, &inputA);
            if (!ok(s)) {
                return s;
            }
            s = getColourInput(textureGenerator, 1, line, &inputB);
            if (!ok(s)) {
                return s;
            }

            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());
            for (std::size_t i = 0; i < w; i++) {
                const i32 aWeight = inputC[i];
                if (aWeight == 4096) {
                    lineOut.r[i] = inputA.r[i];
                    lineOut.g[i] = inputA.g[i];
                    lineOut.b[i] = inputA.b[i];
                } else if (aWeight == 0) {
                    lineOut.r[i] = inputB.r[i];
                    lineOut.g[i] = inputB.g[i];
                    lineOut.b[i] = inputB.b[i];
                } else {
                    const i32 bWeight = javaSub(4096, aWeight);
                    lineOut.r[i] = javaShr(javaAdd(javaMul(aWeight, inputA.r[i]), javaMul(bWeight, inputB.r[i])), 12);
                    lineOut.g[i] = javaShr(javaAdd(javaMul(aWeight, inputA.g[i]), javaMul(bWeight, inputB.g[i])), 12);
                    lineOut.b[i] = javaShr(javaAdd(javaMul(aWeight, inputA.b[i]), javaMul(bWeight, inputB.b[i])), 12);
                }
            }
        }
        *out = lineOut;
        return Status::Ok;
    }
};

} // namespace rs
