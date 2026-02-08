#pragma once

#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../types.hpp"
#include "../../../util/JavaInt32.hpp"
#include "../TextureGenerator.hpp"
#include "TextureOperation.hpp"

namespace rs {

class ColourStripOperation final : public TextureOperationImpl<ColourStripOperation> {
public:
    ColourStripOperation() noexcept : TextureOperationImpl(1, false) {}

    Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept override {
        (void)alloc;
        if (fieldId == 0) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            colourR_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 1) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            colourG_ = static_cast<i32>(v);
            return Status::Ok;
        }
        if (fieldId == 2) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) return s;
            colourB_ = static_cast<i32>(v);
            return Status::Ok;
        }
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
            ColourLine in{};
            const Status s = getColourInput(textureGenerator, 0, line, &in);
            if (!ok(s)) {
                *out = ColourLine{};
                return s;
            }
            const i32 w = textureGenerator.width();
            for (i32 x = 0; x < w; x++) {
                const std::size_t xi = static_cast<std::size_t>(x);
                const i32 vr = in.r[xi];
                const i32 vg = in.g[xi];
                const i32 vb = in.b[xi];
                if (vr != vb || vb != vg) {
                    lineOut.r[xi] = colourR_;
                    lineOut.g[xi] = colourG_;
                    lineOut.b[xi] = colourB_;
                } else {
                    lineOut.r[xi] = javaMulShift(colourR_, vr, 12);
                    lineOut.g[xi] = javaMulShift(colourG_, vg, 12);
                    lineOut.b[xi] = javaMulShift(colourB_, vb, 12);
                }
            }
        }
        *out = lineOut;
        return Status::Ok;
    }

private:
    i32 colourR_ = 4096;
    i32 colourG_ = 4096;
    i32 colourB_ = 4096;
};

} // namespace rs
