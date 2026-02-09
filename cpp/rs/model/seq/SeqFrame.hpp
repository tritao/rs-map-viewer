#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "SeqBase.hpp"
#include "SeqBaseLoader.hpp"
#include "SeqTransformType.hpp"

namespace rs {

// Mirrors src/rs/model/seq/SeqFrame.ts (Dat2 path).
struct SeqFrame final {
    i32 frameLength = 0;
    i32 baseId = -1;
    i32 transformCount = 0;

    Vec<i32> transformGroups{};
    Vec<i32> transformX{};
    Vec<i32> transformY{};
    Vec<i32> transformZ{};
    Vec<i32> resetOriginGroups{};

    bool hasAlphaTransform = false;
    bool hasColorTransform = false;

    explicit SeqFrame(Allocator& alloc = defaultAllocator()) noexcept
        : transformGroups(alloc),
          transformX(alloc),
          transformY(alloc),
          transformZ(alloc),
          resetOriginGroups(alloc) {}
};

struct SeqFrameDecodeScratch final {
    Vec<i32> transformGroupCache{};
    Vec<i32> transformXCache{};
    Vec<i32> transformYCache{};
    Vec<i32> transformZCache{};
    Vec<i32> resetOriginGroupsCache{};

    explicit SeqFrameDecodeScratch(Allocator& alloc = defaultAllocator()) noexcept
        : transformGroupCache(alloc),
          transformXCache(alloc),
          transformYCache(alloc),
          transformZCache(alloc),
          resetOriginGroupsCache(alloc) {}

    Status ensureCapacity(std::size_t size) noexcept {
        if (transformGroupCache.size() >= size) {
            return Status::Ok;
        }
        auto rr = transformGroupCache.resize(size);
        if (!rr.isOk()) return rr.status();
        rr = transformXCache.resize(size);
        if (!rr.isOk()) return rr.status();
        rr = transformYCache.resize(size);
        if (!rr.isOk()) return rr.status();
        rr = transformZCache.resize(size);
        if (!rr.isOk()) return rr.status();
        rr = resetOriginGroupsCache.resize(size);
        if (!rr.isOk()) return rr.status();
        return Status::Ok;
    }
};

inline Status decodeDatSeqBase(
    Span<const u8> data,
    Allocator& alloc,
    SeqBase* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }

    Uint8ArrayReader reader(data, 0);
    u8 countU8 = 0;
    Status s = reader.readUnsignedByte(&countU8);
    if (!ok(s)) {
        return s;
    }
    const i32 count = static_cast<i32>(countU8);

    SeqBase base(-1, alloc);
    base.count = count;

    auto rr = base.types.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) return rr.status();
    rr = base.transformActor.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) return rr.status();
    rr = base.masks.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) return rr.status();
    rr = base.labels.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) return rr.status();

    for (i32 i = 0; i < count; i++) {
        u8 rawType = 0;
        s = reader.readUnsignedByte(&rawType);
        if (!ok(s)) return s;
        base.types[static_cast<std::size_t>(i)] = static_cast<SeqTransformType>(static_cast<i32>(rawType));
        base.transformActor[static_cast<std::size_t>(i)] = 1;
        base.masks[static_cast<std::size_t>(i)] = -1;
    }

    for (i32 i = 0; i < count; i++) {
        u8 subCountU8 = 0;
        s = reader.readUnsignedByte(&subCountU8);
        if (!ok(s)) return s;
        Vec<i32> labels(alloc);
        rr = labels.resize(static_cast<std::size_t>(subCountU8));
        if (!rr.isOk()) return rr.status();
        for (std::size_t l = 0; l < labels.size(); l++) {
            u8 value = 0;
            s = reader.readUnsignedByte(&value);
            if (!ok(s)) return s;
            labels[l] = static_cast<i32>(value);
        }
        base.labels[static_cast<std::size_t>(i)] = rs::move(labels);
    }

    *out = rs::move(base);
    return Status::Ok;
}

inline Status decodeDatSeqFrameMap(
    Span<const u8> data,
    SeqFrameDecodeScratch* scratch,
    Allocator& alloc,
    Vec<i32>* outFrameIds,
    Vec<SeqFrame>* outFrames) noexcept {
    if (!scratch || !outFrameIds || !outFrames) {
        return Status::InvalidArgument;
    }
    if (data.size() < 8) {
        return Status::BadFormat;
    }

    Uint8ArrayReader footer(data, data.size() - 8);
    u16 frameMapOffset = 0;
    u16 flagOffset = 0;
    u16 transformOffset = 0;
    u16 frameLengthOffset = 0;
    Status s = footer.readUnsignedShort(&frameMapOffset);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&flagOffset);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&transformOffset);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&frameLengthOffset);
    if (!ok(s)) return s;

    std::size_t totalOffset = 0;
    const std::size_t frameMapStart = totalOffset;
    totalOffset += static_cast<std::size_t>(frameMapOffset) + 2;
    const std::size_t flagStart = totalOffset;
    totalOffset += static_cast<std::size_t>(flagOffset);
    const std::size_t transformStart = totalOffset;
    totalOffset += static_cast<std::size_t>(transformOffset);
    const std::size_t frameLengthStart = totalOffset;
    totalOffset += static_cast<std::size_t>(frameLengthOffset);
    const std::size_t baseStart = totalOffset;
    if (baseStart > data.size() - 8) {
        return Status::BadFormat;
    }

    SeqBase base(-1, alloc);
    s = decodeDatSeqBase(data.subspan(baseStart, (data.size() - 8) - baseStart), alloc, &base);
    if (!ok(s)) return s;

    Uint8ArrayReader frameMapReader(data, 0);
    Uint8ArrayReader flagReader(data, 0);
    Uint8ArrayReader transformReader(data, 0);
    Uint8ArrayReader frameLengthReader(data, 0);

    s = frameMapReader.seek(frameMapStart);
    if (!ok(s)) return s;
    s = flagReader.seek(flagStart);
    if (!ok(s)) return s;
    s = transformReader.seek(transformStart);
    if (!ok(s)) return s;
    s = frameLengthReader.seek(frameLengthStart);
    if (!ok(s)) return s;

    outFrameIds->clear();
    outFrames->clear();

    u16 frameCountU16 = 0;
    s = frameMapReader.readUnsignedShort(&frameCountU16);
    if (!ok(s)) return s;
    auto rr = outFrameIds->reserve(static_cast<std::size_t>(frameCountU16));
    if (!rr.isOk()) return rr.status();
    rr = outFrames->reserve(static_cast<std::size_t>(frameCountU16));
    if (!rr.isOk()) return rr.status();

    for (i32 f = 0; f < static_cast<i32>(frameCountU16); f++) {
        u16 frameIdU16 = 0;
        u8 frameLengthU8 = 0;
        u8 countU8 = 0;
        s = frameMapReader.readUnsignedShort(&frameIdU16);
        if (!ok(s)) return s;
        s = frameLengthReader.readUnsignedByte(&frameLengthU8);
        if (!ok(s)) return s;
        s = frameMapReader.readUnsignedByte(&countU8);
        if (!ok(s)) return s;

        const i32 count = static_cast<i32>(countU8);
        s = scratch->ensureCapacity(static_cast<std::size_t>(count));
        if (!ok(s)) return s;

        i32 transformCount = 0;
        i32 resetOriginGroup = -1;
        i32 lastResetOriginGroup = -1;
        bool hasAlphaTransform = false;

        for (i32 i = 0; i < count; i++) {
            const std::size_t ii = static_cast<std::size_t>(i);
            if (ii >= base.types.size()) return Status::BadFormat;
            const SeqTransformType type = base.types[ii];

            if (type == SeqTransformType::ORIGIN) {
                resetOriginGroup = i;
            }

            u8 flag = 0;
            s = flagReader.readUnsignedByte(&flag);
            if (!ok(s)) return s;
            if (flag == 0) {
                continue;
            }

            if (type == SeqTransformType::ORIGIN) {
                lastResetOriginGroup = i;
            }

            const std::size_t ti = static_cast<std::size_t>(transformCount);
            scratch->transformGroupCache[ti] = i;

            i32 defaultValue = 0;
            if (type == SeqTransformType::SCALE) {
                defaultValue = 128;
            }

            if ((flag & 0x1) != 0) {
                s = transformReader.readSmart2(&scratch->transformXCache[ti]);
                if (!ok(s)) return s;
            } else {
                scratch->transformXCache[ti] = defaultValue;
            }

            if ((flag & 0x2) != 0) {
                s = transformReader.readSmart2(&scratch->transformYCache[ti]);
                if (!ok(s)) return s;
            } else {
                scratch->transformYCache[ti] = defaultValue;
            }

            if ((flag & 0x4) != 0) {
                s = transformReader.readSmart2(&scratch->transformZCache[ti]);
                if (!ok(s)) return s;
            } else {
                scratch->transformZCache[ti] = defaultValue;
            }

            scratch->resetOriginGroupsCache[ti] = -1;
            if (type == SeqTransformType::TRANSLATE ||
                type == SeqTransformType::ROTATE ||
                type == SeqTransformType::SCALE) {
                if (resetOriginGroup > lastResetOriginGroup) {
                    scratch->resetOriginGroupsCache[ti] = resetOriginGroup;
                    lastResetOriginGroup = resetOriginGroup;
                }
            } else if (type == SeqTransformType::ALPHA) {
                hasAlphaTransform = true;
            }

            transformCount++;
        }

        SeqFrame frame(alloc);
        frame.frameLength = static_cast<i32>(frameLengthU8);
        frame.baseId = -1;
        frame.transformCount = transformCount;
        frame.hasAlphaTransform = hasAlphaTransform;
        frame.hasColorTransform = false;

        rr = frame.transformGroups.resize(static_cast<std::size_t>(transformCount));
        if (!rr.isOk()) return rr.status();
        rr = frame.transformX.resize(static_cast<std::size_t>(transformCount));
        if (!rr.isOk()) return rr.status();
        rr = frame.transformY.resize(static_cast<std::size_t>(transformCount));
        if (!rr.isOk()) return rr.status();
        rr = frame.transformZ.resize(static_cast<std::size_t>(transformCount));
        if (!rr.isOk()) return rr.status();
        rr = frame.resetOriginGroups.resize(static_cast<std::size_t>(transformCount));
        if (!rr.isOk()) return rr.status();

        for (i32 i = 0; i < transformCount; i++) {
            const std::size_t ii = static_cast<std::size_t>(i);
            frame.transformGroups[ii] = scratch->transformGroupCache[ii];
            frame.transformX[ii] = scratch->transformXCache[ii];
            frame.transformY[ii] = scratch->transformYCache[ii];
            frame.transformZ[ii] = scratch->transformZCache[ii];
            frame.resetOriginGroups[ii] = scratch->resetOriginGroupsCache[ii];
        }

        auto idRes = outFrameIds->pushBack(static_cast<i32>(frameIdU16));
        if (!idRes.isOk()) return idRes.status();
        auto frameRes = outFrames->pushBack(rs::move(frame));
        if (!frameRes.isOk()) return frameRes.status();
    }

    return Status::Ok;
}

inline Status decodeDat2SeqFrame(
    const CacheInfo& cacheInfo,
    const Dat2SeqBaseLoader& baseLoader,
    Span<const u8> data,
    SeqFrameDecodeScratch* scratch,
    Allocator& alloc,
    SeqFrame* out) noexcept {
    if (!scratch || !out) {
        return Status::InvalidArgument;
    }

    Uint8ArrayReader flagsReader(data, 0);
    Uint8ArrayReader valuesReader(data, 0);

    if (cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 610) {
        u8 ignored = 0;
        Status s = flagsReader.readUnsignedByte(&ignored);
        if (!ok(s)) return s;
    }

    u16 baseIdU16 = 0;
    Status s = flagsReader.readUnsignedShort(&baseIdU16);
    if (!ok(s)) {
        return s;
    }
    const i32 baseId = static_cast<i32>(baseIdU16);

    const SeqBase* base = nullptr;
    s = baseLoader.tryLoad(baseId, &base);
    if (!ok(s) || !base) {
        return ok(s) ? Status::NotFound : s;
    }

    u8 countU8 = 0;
    s = flagsReader.readUnsignedByte(&countU8);
    if (!ok(s)) {
        return s;
    }
    const i32 count = static_cast<i32>(countU8);

    s = scratch->ensureCapacity(static_cast<std::size_t>(count));
    if (!ok(s)) {
        return s;
    }

    const std::size_t valuesOffset = flagsReader.tell() + static_cast<std::size_t>(count);
    s = valuesReader.seek(valuesOffset);
    if (!ok(s)) {
        return s;
    }

    i32 transformCount = 0;
    i32 resetOriginGroup = -1;
    i32 lastResetOriginGroup = -1;

    bool hasAlphaTransform = false;
    bool hasColorTransform = false;

    for (i32 i = 0; i < count; i++) {
        if (static_cast<std::size_t>(i) >= base->types.size()) {
            return Status::BadFormat;
        }
        const SeqTransformType type = base->types[static_cast<std::size_t>(i)];

        if (type == SeqTransformType::ORIGIN) {
            resetOriginGroup = i;
        }

        u8 flag = 0;
        s = flagsReader.readUnsignedByte(&flag);
        if (!ok(s)) {
            return s;
        }
        if (flag == 0) {
            continue;
        }

        if (type == SeqTransformType::ORIGIN) {
            lastResetOriginGroup = i;
        }

        const std::size_t ti = static_cast<std::size_t>(transformCount);
        scratch->transformGroupCache[ti] = i;

        i32 defaultValue = 0;
        if (type == SeqTransformType::SCALE || type == SeqTransformType::TYPE_10) {
            defaultValue = 128;
        }

        if ((flag & 0x1) != 0) {
            s = valuesReader.readSmart2(&scratch->transformXCache[ti]);
            if (!ok(s)) return s;
        } else {
            scratch->transformXCache[ti] = defaultValue;
        }

        if ((flag & 0x2) != 0) {
            s = valuesReader.readSmart2(&scratch->transformYCache[ti]);
            if (!ok(s)) return s;
        } else {
            scratch->transformYCache[ti] = defaultValue;
        }

        if ((flag & 0x4) != 0) {
            s = valuesReader.readSmart2(&scratch->transformZCache[ti]);
            if (!ok(s)) return s;
        } else {
            scratch->transformZCache[ti] = defaultValue;
        }

        if (cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 610) {
            if (type == SeqTransformType::ORIGIN || type == SeqTransformType::TRANSLATE) {
                scratch->transformXCache[ti] >>= 2;
                scratch->transformYCache[ti] >>= 2;
                scratch->transformZCache[ti] >>= 2;
            } else if (type == SeqTransformType::ROTATE) {
                scratch->transformXCache[ti] >>= 4;
                scratch->transformYCache[ti] >>= 4;
                scratch->transformZCache[ti] >>= 4;
            }
        }

        scratch->resetOriginGroupsCache[ti] = -1;
        if (type == SeqTransformType::TRANSLATE ||
            type == SeqTransformType::ROTATE ||
            type == SeqTransformType::SCALE) {
            if (resetOriginGroup > lastResetOriginGroup) {
                scratch->resetOriginGroupsCache[ti] = resetOriginGroup;
                lastResetOriginGroup = resetOriginGroup;
            }
        } else if (type == SeqTransformType::ALPHA) {
            hasAlphaTransform = true;
        } else if (type == SeqTransformType::LIGHT) {
            hasColorTransform = true;
        }

        transformCount++;
    }

    if (count != 0 && valuesReader.tell() != data.size()) {
        return Status::BadFormat;
    }

    SeqFrame frame(alloc);
    frame.baseId = baseId;
    frame.frameLength = 0;
    frame.transformCount = transformCount;
    frame.hasAlphaTransform = hasAlphaTransform;
    frame.hasColorTransform = hasColorTransform;

    auto rr = frame.transformGroups.resize(static_cast<std::size_t>(transformCount));
    if (!rr.isOk()) return rr.status();
    rr = frame.transformX.resize(static_cast<std::size_t>(transformCount));
    if (!rr.isOk()) return rr.status();
    rr = frame.transformY.resize(static_cast<std::size_t>(transformCount));
    if (!rr.isOk()) return rr.status();
    rr = frame.transformZ.resize(static_cast<std::size_t>(transformCount));
    if (!rr.isOk()) return rr.status();
    rr = frame.resetOriginGroups.resize(static_cast<std::size_t>(transformCount));
    if (!rr.isOk()) return rr.status();

    for (i32 i = 0; i < transformCount; i++) {
        const std::size_t ii = static_cast<std::size_t>(i);
        frame.transformGroups[ii] = scratch->transformGroupCache[ii];
        frame.transformX[ii] = scratch->transformXCache[ii];
        frame.transformY[ii] = scratch->transformYCache[ii];
        frame.transformZ[ii] = scratch->transformZCache[ii];
        frame.resetOriginGroups[ii] = scratch->resetOriginGroupsCache[ii];
    }

    *out = rs::move(frame);
    return Status::Ok;
}

} // namespace rs
