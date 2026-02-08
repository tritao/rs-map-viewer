#pragma once

#include <cstddef>

#include "../../../core/Allocator.hpp"
#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class PseudoRandomNoiseOperation final : public TextureOperationImpl<PseudoRandomNoiseOperation> {
public:
    PseudoRandomNoiseOperation() noexcept : TextureOperationImpl(0, true) {}

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
            const i32 vGrad = textureGenerator.verticalGradient()[static_cast<std::size_t>(line)];
            const i32 w = textureGenerator.width();
            for (i32 px = 0; px < w; px++) {
                const i32 hGrad = textureGenerator.horizontalGradient()[static_cast<std::size_t>(px)];
                lineOut[static_cast<std::size_t>(px)] = noise(hGrad, vGrad) % 4096;
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    static i32 noise(i32 x, i32 y) noexcept {
        // Mirrors Java (TextureOpPseudoRandomNoise.method3103).
        i32 n = javaAdd(x, javaMul(y, 57));
        n = static_cast<i32>(n ^ javaShl(n, 1));

        const i32 nn = javaMul(n, n);
        const i32 t0 = javaAdd(789221, javaMul(15731, nn));
        const i32 t1 = javaAdd(javaMul(t0, n), 1376312589);
        const u32 masked = static_cast<u32>(t1) & 0x7FFFFFFFu;
        const i32 q = static_cast<i32>(masked / 262144u);
        return 4096 - q;
    }
};

} // namespace rs
