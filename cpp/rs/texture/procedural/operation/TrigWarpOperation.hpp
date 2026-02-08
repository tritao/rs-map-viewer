#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class TrigWarpOperation final : public TextureOperationImpl<TrigWarpOperation> {
public:
    TrigWarpOperation() noexcept : TextureOperationImpl(3, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            radiusMultiplierQ16_ = static_cast<i32>(v) << 4;
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
            const Span<const i32> sine = textureGenerator.sineTableQ12();
            const Span<const i32> cosine = textureGenerator.cosineTableQ12();

            Span<i32> angleInput;
            Span<i32> radiusInput;
            Status s = getMonochromeInput(textureGenerator, 1, line, &angleInput);
            if (!ok(s)) {
                return s;
            }
            s = getMonochromeInput(textureGenerator, 2, line, &radiusInput);
            if (!ok(s)) {
                return s;
            }

            const i32 widthMask = textureGenerator.widthMask();
            const i32 heightMask = textureGenerator.heightMask();
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());

            for (std::size_t pixel = 0; pixel < w; pixel++) {
                const i32 angle = (angleInput[pixel] >> 4) & 0xFF;
                const i32 radius = javaMulShift(radiusInput[pixel], radiusMultiplierQ16_, 12);
                const i32 dx = javaMulShift(cosine[static_cast<std::size_t>(angle)], radius, 12);
                const i32 dy = javaMulShift(sine[static_cast<std::size_t>(angle)], radius, 12);
                const i32 sampleX = (static_cast<i32>(pixel) + (dx >> 12)) & widthMask;
                const i32 sampleY = (line + (dy >> 12)) & heightMask;

                Span<i32> input;
                s = getMonochromeInput(textureGenerator, 0, sampleY, &input);
                if (!ok(s)) {
                    return s;
                }
                lineOut[pixel] = input[static_cast<std::size_t>(sampleX)];
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
            const Span<const i32> sine = textureGenerator.sineTableQ12();
            const Span<const i32> cosine = textureGenerator.cosineTableQ12();

            Span<i32> angleInput;
            Span<i32> radiusInput;
            Status s = getMonochromeInput(textureGenerator, 1, line, &angleInput);
            if (!ok(s)) {
                return s;
            }
            s = getMonochromeInput(textureGenerator, 2, line, &radiusInput);
            if (!ok(s)) {
                return s;
            }

            const i32 widthMask = textureGenerator.widthMask();
            const i32 heightMask = textureGenerator.heightMask();
            const std::size_t w = static_cast<std::size_t>(textureGenerator.width());

            for (std::size_t pixel = 0; pixel < w; pixel++) {
                const i32 angle = (javaMulShift(angleInput[pixel], 255, 12)) & 0xFF;
                const i32 radius = javaMulShift(radiusInput[pixel], radiusMultiplierQ16_, 12);
                const i32 dx = javaMulShift(cosine[static_cast<std::size_t>(angle)], radius, 12);
                const i32 dy = javaMulShift(sine[static_cast<std::size_t>(angle)], radius, 12);
                const i32 sampleX = (static_cast<i32>(pixel) + (dx >> 12)) & widthMask;
                const i32 sampleY = (line + (dy >> 12)) & heightMask;

                ColourLine input{};
                s = getColourInput(textureGenerator, 0, sampleY, &input);
                if (!ok(s)) {
                    return s;
                }
                lineOut.r[pixel] = input.r[static_cast<std::size_t>(sampleX)];
                lineOut.g[pixel] = input.g[static_cast<std::size_t>(sampleX)];
                lineOut.b[pixel] = input.b[static_cast<std::size_t>(sampleX)];
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 radiusMultiplierQ16_ = 32768;
};

} // namespace rs
