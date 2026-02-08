#include "TextureOperationFactory.hpp"

#include <cstddef>
#include <new>

#include "../../../core/Move.hpp"
#include "../../../core/ScopeGuard.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "ArithmeticOperation.hpp"
#include "BlurOperation.hpp"
#include "BricksOperation.hpp"
#include "BrightnessOperation.hpp"
#include "ClampOperation.hpp"
#include "ColourStripOperation.hpp"
#include "ConstantColourOperation.hpp"
#include "ConstantMonochromeOperation.hpp"
#include "CurveOperation.hpp"
#include "DiagonalGradientOperation.hpp"
#include "IrregularBricksOperation.hpp"
#include "HslOperation.hpp"
#include "KaleidoscopeOperation.hpp"
#include "GradientOperation.hpp"
#include "GrayScaleOperation.hpp"
#include "HerringboneOperation.hpp"
#include "HorizontalGradientOperation.hpp"
#include "InvertOperation.hpp"
#include "LerpOperation.hpp"
#include "LineNoiseOperation.hpp"
#include "EmbossOperation.hpp"
#include "PerlinNoiseOperation.hpp"
#include "MirrorOperation.hpp"
#include "MonochromeEdgeDetectorOperation.hpp"
#include "NormalMapOperation.hpp"
#include "PseudoRandomNoiseOperation.hpp"
#include "RangeOperation.hpp"
#include "RangeThresholdOperation.hpp"
#include "ShapeRasterizerOperation.hpp"
#include "SquareWaveformOperation.hpp"
#include "SpriteSourceOperation.hpp"
#include "TilingSpriteOperation.hpp"
#include "TilingOperation.hpp"
#include "TextureSourceOperation.hpp"
#include "TrigWarpOperation.hpp"
#include "VerticalGradientOperation.hpp"
#include "VoronoiNoiseOperation.hpp"
#include "WavyCrossOperation.hpp"
#include "WeaveOperation.hpp"

namespace rs {

template <typename T>
static Result<T*> allocNew(Allocator& alloc) noexcept {
    void* mem = alloc.alloc(alloc.ctx, sizeof(T), alignof(T));
    if (!mem) {
        return Result<T*>::err(Status::OutOfMemory);
    }
    T* obj = new (mem) T();
    return Result<T*>::ok(obj);
}

static Result<TextureOperation*> instantiate(TextureOperationTypeId typeId, Allocator& alloc) noexcept {
    switch (typeId) {
    case TextureOperationTypeId::ConstantMonochrome: {
        auto r = allocNew<ConstantMonochromeOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::ConstantColour: {
        auto r = allocNew<ConstantColourOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::HorizontalGradient: {
        auto r = allocNew<HorizontalGradientOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::VerticalGradient: {
        auto r = allocNew<VerticalGradientOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Bricks: {
        auto r = allocNew<BricksOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Blur: {
        auto r = allocNew<BlurOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Clamp: {
        auto r = allocNew<ClampOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Arithmetic: {
        auto r = allocNew<ArithmeticOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Curve: {
        auto r = allocNew<CurveOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Gradient: {
        auto r = allocNew<GradientOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::ColourStrip: {
        auto r = allocNew<ColourStripOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::DiagonalGradient: {
        auto r = allocNew<DiagonalGradientOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Mirror: {
        auto r = allocNew<MirrorOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::RangeThreshold: {
        auto r = allocNew<RangeThresholdOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::PseudoRandomNoise: {
        auto r = allocNew<PseudoRandomNoiseOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Lerp: {
        auto r = allocNew<LerpOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Invert: {
        auto r = allocNew<InvertOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Kaleidoscope: {
        auto r = allocNew<KaleidoscopeOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::GrayScale: {
        auto r = allocNew<GrayScaleOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Brightness: {
        auto r = allocNew<BrightnessOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::TextureSource: {
        auto r = allocNew<TextureSourceOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::SpriteSource: {
        auto r = allocNew<SpriteSourceOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::PerlinNoise: {
        auto r = allocNew<PerlinNoiseOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::MonochromeEdgeDetector: {
        auto r = allocNew<MonochromeEdgeDetectorOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Range: {
        auto r = allocNew<RangeOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::NormalMap: {
        auto r = allocNew<NormalMapOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::WavyCross: {
        auto r = allocNew<WavyCrossOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Weave: {
        auto r = allocNew<WeaveOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Herringbone: {
        auto r = allocNew<HerringboneOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::IrregularBricks: {
        auto r = allocNew<IrregularBricksOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Emboss: {
        auto r = allocNew<EmbossOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::VoronoiNoise: {
        auto r = allocNew<VoronoiNoiseOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Hsl: {
        auto r = allocNew<HslOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::TilingSprite: {
        auto r = allocNew<TilingSpriteOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::TrigWarp: {
        auto r = allocNew<TrigWarpOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::Tiling: {
        auto r = allocNew<TilingOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::SquareWaveform: {
        auto r = allocNew<SquareWaveformOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::LineNoise: {
        auto r = allocNew<LineNoiseOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    case TextureOperationTypeId::ShapeRasterizer: {
        auto r = allocNew<ShapeRasterizerOperation>(alloc);
        if (!r.isOk()) {
            return Result<TextureOperation*>::err(r.status());
        }
        return Result<TextureOperation*>::ok(r.value());
    }
    default:
        return Result<TextureOperation*>::err(Status::Unsupported);
    }
}

Result<TextureOperationCreateResult> createTextureOperation(Uint8ArrayReader& reader, Allocator& alloc) noexcept {
    u8 opId = 0;
    u8 typeIdU8 = 0;
    u8 cacheSlotCount = 0;
    u8 propertyCount = 0;

    Status s = reader.readUnsignedByte(&opId);
    if (!ok(s)) {
        return Result<TextureOperationCreateResult>::err(s);
    }
    s = reader.readUnsignedByte(&typeIdU8);
    if (!ok(s)) {
        return Result<TextureOperationCreateResult>::err(s);
    }
    s = reader.readUnsignedByte(&cacheSlotCount);
    if (!ok(s)) {
        return Result<TextureOperationCreateResult>::err(s);
    }
    s = reader.readUnsignedByte(&propertyCount);
    if (!ok(s)) {
        return Result<TextureOperationCreateResult>::err(s);
    }

    auto opRes = instantiate(static_cast<TextureOperationTypeId>(typeIdU8), alloc);
    if (!opRes.isOk()) {
        return Result<TextureOperationCreateResult>::err(opRes.status());
    }
    TextureOperation* op = opRes.value();

    auto opGuard = makeScopeGuard([&]() noexcept {
        if (op) {
            op->destroy(alloc);
        }
    });

    op->setHeader(static_cast<i32>(opId), cacheSlotCount);

    for (u8 i = 0; i < propertyCount; i++) {
        u8 fieldId = 0;
        s = reader.readUnsignedByte(&fieldId);
        if (!ok(s)) {
            return Result<TextureOperationCreateResult>::err(s);
        }
        s = op->decode(fieldId, reader, alloc);
        if (!ok(s)) {
            return Result<TextureOperationCreateResult>::err(s);
        }
    }
    s = op->init();
    if (!ok(s)) {
        return Result<TextureOperationCreateResult>::err(s);
    }

    TextureOperationCreateResult out{};
    out.op = op;
    out.inputCount = op->inputCount();
    opGuard.dismiss();
    return Result<TextureOperationCreateResult>::ok(out);
}

} // namespace rs
