#include "ProceduralTexture.hpp"

#include <cstddef>

#include "../../core/Move.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "operation/TextureOperationFactory.hpp"

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

void ProceduralTexture::release() noexcept {
    if (!alloc_) {
        operations_.clear();
        colourOperation_ = nullptr;
        monochromeOperation_ = nullptr;
        alphaOperation_ = nullptr;
        return;
    }
    for (std::size_t i = 0; i < operations_.size(); i++) {
        TextureOperation* op = operations_[i];
        if (!op) {
            continue;
        }
        // Destroy ops before freeing any decode-owned buffers (e.g. inputs arrays).
        op->destroy(*alloc_);
        operations_[i] = nullptr;
    }
    alloc_ = nullptr;
    operations_.clear();
    colourOperation_ = nullptr;
    monochromeOperation_ = nullptr;
    alphaOperation_ = nullptr;
}

ProceduralTexture::~ProceduralTexture() {
    release();
}

ProceduralTexture& ProceduralTexture::operator=(ProceduralTexture&& other) noexcept {
    if (this == &other) {
        return *this;
    }
    release();

    alloc_ = other.alloc_;
    operations_ = rs::move(other.operations_);
    colourOperation_ = other.colourOperation_;
    monochromeOperation_ = other.monochromeOperation_;
    alphaOperation_ = other.alphaOperation_;

    other.alloc_ = nullptr;
    other.colourOperation_ = nullptr;
    other.monochromeOperation_ = nullptr;
    other.alphaOperation_ = nullptr;
    return *this;
}

Result<ProceduralTexture> ProceduralTexture::decode(Uint8ArrayReader& reader, bool hasAlphaOperation, Allocator& alloc) noexcept {
    u8 opCountU8 = 0;
    Status s = reader.readUnsignedByte(&opCountU8);
    if (!ok(s)) {
        return Result<ProceduralTexture>::err(s);
    }
    const i32 opCount = static_cast<i32>(opCountU8);
    if (opCount <= 0) {
        return Result<ProceduralTexture>::err(Status::BadFormat);
    }

    ProceduralTexture out{};
    out.alloc_ = &alloc;
    out.operations_ = Vec<TextureOperation*>(alloc);

    auto rr = out.operations_.resize(static_cast<std::size_t>(opCount));
    if (!rr.isOk()) {
        return Result<ProceduralTexture>::err(rr.status());
    }
    for (std::size_t i = 0; i < out.operations_.size(); i++) {
        out.operations_[i] = nullptr;
    }

    // Input connections: store in a flat buffer and resolve in a second pass.
    Vec<u16> connOffsets(alloc);
    Vec<u8> connCounts(alloc);
    Vec<u8> connData(alloc);

    rr = connOffsets.resize(static_cast<std::size_t>(opCount));
    if (!rr.isOk()) {
        return Result<ProceduralTexture>::err(rr.status());
    }
    rr = connCounts.resize(static_cast<std::size_t>(opCount));
    if (!rr.isOk()) {
        return Result<ProceduralTexture>::err(rr.status());
    }

    for (i32 op = 0; op < opCount; op++) {
        auto opRes = createTextureOperation(reader, alloc);
        if (!opRes.isOk()) {
            return Result<ProceduralTexture>::err(opRes.status());
        }
        TextureOperation* operation = opRes.value().op;
        out.operations_[static_cast<std::size_t>(op)] = operation;

        const i32 inputCount = operation->inputCount();
        if (inputCount < 0 || inputCount > 255) {
            return Result<ProceduralTexture>::err(Status::BadFormat);
        }

        connOffsets[static_cast<std::size_t>(op)] = static_cast<u16>(connData.size());
        connCounts[static_cast<std::size_t>(op)] = static_cast<u8>(inputCount);

        for (i32 i = 0; i < inputCount; i++) {
            u8 in = 0;
            s = reader.readUnsignedByte(&in);
            if (!ok(s)) {
                return Result<ProceduralTexture>::err(s);
            }
            auto pr = connData.pushBack(in);
            if (!pr.isOk()) {
                return Result<ProceduralTexture>::err(pr.status());
            }
        }
    }

    // Resolve input pointers.
    for (i32 op = 0; op < opCount; op++) {
        TextureOperation* operation = out.operations_[static_cast<std::size_t>(op)];
        const i32 inputCount = static_cast<i32>(connCounts[static_cast<std::size_t>(op)]);
        if (inputCount == 0) {
            continue;
        }

        // Allocate inputs array for this op (owned by the op).
        auto inputsRes = operation->tryAllocOwnedArray<TextureOperation*>(static_cast<std::size_t>(inputCount), alloc);
        if (!inputsRes.isOk()) {
            return Result<ProceduralTexture>::err(inputsRes.status());
        }
        auto** inputs = inputsRes.value();
        for (i32 i = 0; i < inputCount; i++) {
            const std::size_t connIdx = static_cast<std::size_t>(connOffsets[static_cast<std::size_t>(op)]) + static_cast<std::size_t>(i);
            if (connIdx >= connData.size()) {
                return Result<ProceduralTexture>::err(Status::BadFormat);
            }
            const u8 srcOpU8 = connData[connIdx];
            const i32 srcOp = static_cast<i32>(srcOpU8);
            if (srcOp < 0 || srcOp >= opCount) {
                return Result<ProceduralTexture>::err(Status::BadFormat);
            }
            inputs[i] = out.operations_[static_cast<std::size_t>(srcOp)];
        }
        operation->setInputs(inputs, inputCount);
    }

    // Select output operations.
    u8 colourOpIdx = 0;
    u8 alphaOpIdx = 0;
    u8 monoOpIdx = 0;
    s = reader.readUnsignedByte(&colourOpIdx);
    if (!ok(s)) {
        return Result<ProceduralTexture>::err(s);
    }
    if (hasAlphaOperation) {
        s = reader.readUnsignedByte(&alphaOpIdx);
        if (!ok(s)) {
            return Result<ProceduralTexture>::err(s);
        }
    }
    s = reader.readUnsignedByte(&monoOpIdx);
    if (!ok(s)) {
        return Result<ProceduralTexture>::err(s);
    }

    if (colourOpIdx >= opCountU8 || monoOpIdx >= opCountU8 || (hasAlphaOperation && alphaOpIdx >= opCountU8)) {
        return Result<ProceduralTexture>::err(Status::BadFormat);
    }

    out.colourOperation_ = out.operations_[static_cast<std::size_t>(colourOpIdx)];
    out.monochromeOperation_ = out.operations_[static_cast<std::size_t>(monoOpIdx)];
    out.alphaOperation_ = hasAlphaOperation ? out.operations_[static_cast<std::size_t>(alphaOpIdx)] : nullptr;

    return Result<ProceduralTexture>::ok(rs::move(out));
}

Result<Vec<i32>> ProceduralTexture::getPixelsRgb(TextureGenerator& textureGenerator, i32 width, i32 height, bool flipH, bool flipV, float brightness, Allocator& alloc) noexcept {
    if (!colourOperation_ || operations_.size() == 0) {
        return Result<Vec<i32>>::err(Status::InvalidArgument);
    }
    for (std::size_t i = 0; i < operations_.size(); i++) {
        TextureOperation* op = operations_[i];
        if (!op) {
            return Result<Vec<i32>>::err(Status::BadFormat);
        }
        const Status s = op->initCaches(textureGenerator, width, height, alloc);
        if (!ok(s)) {
            return Result<Vec<i32>>::err(s);
        }
    }
    textureGenerator.initBrightness(brightness);
    Status s = textureGenerator.init(width, height);
    if (!ok(s)) {
        return Result<Vec<i32>>::err(s);
    }

    Vec<i32> pixels(alloc);
    auto rr = pixels.resize(static_cast<std::size_t>(width) * static_cast<std::size_t>(height));
    if (!rr.isOk()) {
        return Result<Vec<i32>>::err(rr.status());
    }

    i32 srcInc = 1;
    i32 srcEnd = width;
    i32 srcStart = 0;
    if (flipH) {
        srcInc = -1;
        srcEnd = -1;
        srcStart = width - 1;
    }

    i32 dstIdx = 0;
    const Span<const i32> bright = textureGenerator.brightnessTable();

    for (i32 line = 0; line < height; line++) {
        if (flipV) {
            dstIdx = line;
        }

        Span<i32> pixelsR;
        Span<i32> pixelsG;
        Span<i32> pixelsB;

        if (colourOperation_->isMonochrome()) {
            Span<i32> mono;
            s = colourOperation_->getMonochromeOutput(textureGenerator, line, &mono);
            if (!ok(s)) {
                return Result<Vec<i32>>::err(s);
            }
            pixelsR = mono;
            pixelsG = mono;
            pixelsB = mono;
        } else {
            ColourLine c{};
            s = colourOperation_->getColourOutput(textureGenerator, line, &c);
            if (!ok(s)) {
                return Result<Vec<i32>>::err(s);
            }
            pixelsR = c.r;
            pixelsG = c.g;
            pixelsB = c.b;
        }

        for (i32 srcIdx = srcStart; srcIdx != srcEnd; srcIdx += srcInc) {
            i32 r = pixelsR[static_cast<std::size_t>(srcIdx)] >> 4;
            r = clampI32(r, 0, 255);
            i32 g = pixelsG[static_cast<std::size_t>(srcIdx)] >> 4;
            g = clampI32(g, 0, 255);
            i32 b = pixelsB[static_cast<std::size_t>(srcIdx)] >> 4;
            b = clampI32(b, 0, 255);

            r = bright[static_cast<std::size_t>(r)];
            g = bright[static_cast<std::size_t>(g)];
            b = bright[static_cast<std::size_t>(b)];

            i32 rgb = r * 0x10000 + g * 0x100 + b;
            if (rgb != 0) {
                rgb |= static_cast<i32>(0xFF000000u);
            } else {
                textureGenerator.isTransparent = true;
            }
            pixels[static_cast<std::size_t>(dstIdx++)] = rgb;
            if (flipV) {
                dstIdx += width - 1;
            }
        }
    }

    for (std::size_t i = 0; i < operations_.size(); i++) {
        operations_[i]->clearCaches();
    }

    return Result<Vec<i32>>::ok(rs::move(pixels));
}

Result<Vec<i32>> ProceduralTexture::getPixelsArgb(TextureGenerator& textureGenerator, i32 width, i32 height, bool flipH, bool flipV, float brightness, Allocator& alloc) noexcept {
    if (!colourOperation_ || operations_.size() == 0) {
        return Result<Vec<i32>>::err(Status::InvalidArgument);
    }
    for (std::size_t i = 0; i < operations_.size(); i++) {
        TextureOperation* op = operations_[i];
        if (!op) {
            return Result<Vec<i32>>::err(Status::BadFormat);
        }
        const Status s = op->initCaches(textureGenerator, width, height, alloc);
        if (!ok(s)) {
            return Result<Vec<i32>>::err(s);
        }
    }
    textureGenerator.initBrightness(brightness);
    Status s = textureGenerator.init(width, height);
    if (!ok(s)) {
        return Result<Vec<i32>>::err(s);
    }

    Vec<i32> pixels(alloc);
    auto rr = pixels.resize(static_cast<std::size_t>(width) * static_cast<std::size_t>(height));
    if (!rr.isOk()) {
        return Result<Vec<i32>>::err(rr.status());
    }

    i32 srcInc = 1;
    i32 srcEnd = width;
    i32 srcStart = 0;
    if (flipH) {
        srcInc = -1;
        srcEnd = -1;
        srcStart = width - 1;
    }

    i32 dstIdx = 0;
    const Span<const i32> bright = textureGenerator.brightnessTable();

    for (i32 line = 0; line < height; line++) {
        if (flipV) {
            dstIdx = line;
        }

        Span<i32> pixelsR;
        Span<i32> pixelsG;
        Span<i32> pixelsB;
        Span<i32> pixelsA(nullptr, 0);
        const bool hasA = (alphaOperation_ != nullptr);

        if (colourOperation_->isMonochrome()) {
            Span<i32> mono;
            s = colourOperation_->getMonochromeOutput(textureGenerator, line, &mono);
            if (!ok(s)) {
                return Result<Vec<i32>>::err(s);
            }
            pixelsR = mono;
            pixelsG = mono;
            pixelsB = mono;
        } else {
            ColourLine c{};
            s = colourOperation_->getColourOutput(textureGenerator, line, &c);
            if (!ok(s)) {
                return Result<Vec<i32>>::err(s);
            }
            pixelsR = c.r;
            pixelsG = c.g;
            pixelsB = c.b;
        }

        if (hasA) {
            if (alphaOperation_->isMonochrome()) {
                s = alphaOperation_->getMonochromeOutput(textureGenerator, line, &pixelsA);
                if (!ok(s)) {
                    return Result<Vec<i32>>::err(s);
                }
            } else {
                ColourLine cA{};
                s = alphaOperation_->getColourOutput(textureGenerator, line, &cA);
                if (!ok(s)) {
                    return Result<Vec<i32>>::err(s);
                }
                pixelsA = cA.r;
            }
        }

        for (i32 srcIdx = srcStart; srcIdx != srcEnd; srcIdx += srcInc) {
            i32 r = pixelsR[static_cast<std::size_t>(srcIdx)] >> 4;
            r = clampI32(r, 0, 255);
            i32 g = pixelsG[static_cast<std::size_t>(srcIdx)] >> 4;
            g = clampI32(g, 0, 255);
            i32 b = pixelsB[static_cast<std::size_t>(srcIdx)] >> 4;
            b = clampI32(b, 0, 255);

            r = bright[static_cast<std::size_t>(r)];
            g = bright[static_cast<std::size_t>(g)];
            b = bright[static_cast<std::size_t>(b)];

            i32 a = 0;
            if (r != 0 || g != 0 || b != 0) {
                if (hasA) {
                    i32 av = pixelsA[static_cast<std::size_t>(srcIdx)] >> 4;
                    a = clampI32(av, 0, 0xFF);
                } else {
                    a = 0xFF;
                }
            }

            if (a != 0xFF) {
                textureGenerator.isTransparent = true;
            }

            const u32 argb =
                (static_cast<u32>(a) << 24) |
                (static_cast<u32>(r) << 16) |
                (static_cast<u32>(g) << 8) |
                static_cast<u32>(b);

            pixels[static_cast<std::size_t>(dstIdx++)] = static_cast<i32>(argb);
            if (flipV) {
                dstIdx += width - 1;
            }
        }
    }

    for (std::size_t i = 0; i < operations_.size(); i++) {
        operations_[i]->clearCaches();
    }

    return Result<Vec<i32>>::ok(rs::move(pixels));
}

} // namespace rs
