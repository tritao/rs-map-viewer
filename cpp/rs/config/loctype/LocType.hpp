#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Status.hpp"
#include "../../core/Str.hpp"
#include "../../core/StrUtil.hpp"
#include "../../core/Vec.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../ParamsMap.hpp"
#include "../TypeDecode.hpp"

namespace rs {

// LocType model groups. The TS layer represents these as `models: number[][]` and optional `types: LocModelType[]`.
// Here we keep both arrays explicit so post() logic can mirror TS.
struct LocType {
    static constexpr i32 DEFAULT_DECOR_DISPLACEMENT = 16;

    i32 id = -1;
    CacheInfo cacheInfo{};

    bool lowDetail = false;

    Vec<Vec<i32>> models{};
    bool hasTypes = false;
    Vec<i32> types{};

    Str name = strLiteral("null");
    bool hasDesc = false;
    Str desc{};

    Vec<i32> recolorFrom{};
    Vec<i32> recolorTo{};

    Vec<i32> retextureFrom{};
    Vec<i32> retextureTo{};

    i32 sizeX = 1;
    i32 sizeY = 1;

    i32 clipType = 2;
    bool blocksProjectile = true;

    i32 isInteractive = -1;

    i32 contouredGround = -1;
    i32 contourGroundType = 0;
    i32 contourGroundParam = -1;

    bool mergeNormals = false;
    bool modelClipped = false;

    i32 seqId = -1;
    i32 decorDisplacement = DEFAULT_DECOR_DISPLACEMENT;

    i32 ambient = 0;
    i32 contrast = 0;

    bool hasAction[10]{};
    Str actions[10]{};

    i32 mapFunctionId = -1;
    i32 mapSceneId = -1;
    bool flipMapSceneSprite = false;

    bool hardShadow = true;
    bool membersOnly = false;
    bool rotateMapSceneSprite = false;
    i32 mapSceneRotationOffset = 0;
    bool animated = false;
    i32 cursor1Op = -1;
    i32 cursor1 = -1;
    i32 cursor2Op = -1;
    i32 cursor2 = -1;
    bool occludeRoofs = false;
    bool forceDynamic = false;

    bool isRotated = false;
    bool clipped = true;

    i32 modelSizeX = 128;
    i32 modelSizeHeight = 128;
    i32 modelSizeY = 128;

    i32 offsetX = 0;
    i32 offsetHeight = 0;
    i32 offsetY = 0;

    bool obstructsGround = false;
    bool isHollow = false;
    i32 supportItems = -1;

    Vec<i32> transforms{};
    i32 transformVarbit = -1;
    i32 transformVarp = -1;

    i32 ambientSoundId = -1;
    i32 ambientSoundDistance = 0;
    i32 ambientSoundChangeTicksMin = 0;
    i32 ambientSoundChangeTicksMax = 0;
    i32 ambientSoundRetain = 0;
    i32 ambientSoundVolume = 0;
    i32 ambientSoundRateMin = 256;
    i32 ambientSoundRateMax = 256;
    i32 ambientSoundSize = 0;
    bool vorbisSound = false;
    bool randomSound = false;
    Vec<i32> ambientSoundIds{};

    bool seqRandomStart = true;
    Vec<i32> randomSeqIds{};
    Vec<i32> randomSeqDelays{};

    Vec<i32> quests{};
    i32 targetHue = 0;
    i32 targetSaturation = 0;
    i32 targetLightness = 0;
    i32 colourShiftPercentage = 0;
    i32 occlusionHeight = 0;
    i32 occlusionOffset = 0;

    ParamsMap params{};

    LocType() = default;
    LocType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    [[nodiscard]] bool isNewModelsFormat() const noexcept {
        return cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 582;
    }

    [[nodiscard]] bool isLargeModelId() const noexcept {
        return cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 670;
    }

    Status readModelId(Uint8ArrayReader& reader, i32* out) const noexcept {
        if (!out) {
            return Status::InvalidArgument;
        }
        if (isLargeModelId()) {
            return reader.readBigSmart(out);
        }
        u16 v = 0;
        const Status s = reader.readUnsignedShort(&v);
        if (!ok(s)) {
            return s;
        }
        *out = static_cast<i32>(v);
        return Status::Ok;
    }

    static i32 toSigned16bit(i32 v) noexcept {
        return static_cast<i32>(static_cast<i16>(v));
    }

    Status skipNewModels(Uint8ArrayReader& reader) const noexcept {
        u8 countU8 = 0;
        Status s = reader.readUnsignedByte(&countU8);
        if (!ok(s)) {
            return s;
        }
        const std::size_t count = static_cast<std::size_t>(countU8);
        for (std::size_t i = 0; i < count; i++) {
            i8 unusedType = 0;
            s = reader.readByte(&unusedType);
            if (!ok(s)) {
                return s;
            }
            u8 modelCountU8 = 0;
            s = reader.readUnsignedByte(&modelCountU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t modelCount = static_cast<std::size_t>(modelCountU8);
            for (std::size_t j = 0; j < modelCount; j++) {
                if (isLargeModelId()) {
                    i32 dummy = 0;
                    s = reader.readBigSmart(&dummy);
                    if (!ok(s)) {
                        return s;
                    }
                } else {
                    u16 dummy = 0;
                    s = reader.readUnsignedShort(&dummy);
                    if (!ok(s)) {
                        return s;
                    }
                }
            }
        }
        return Status::Ok;
    }

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext& ctx) noexcept {
        if (!ctx.strings || !ctx.alloc) {
            return Status::InvalidArgument;
        }

        const u8 strTerm = configStringTerminator(cacheInfo);

        if (isNewModelsFormat() && (opcode == 1 || opcode == 5)) {
            // Mirrors TS logic.
            const bool someBool = false;
            if (opcode == 5 && someBool) {
                Status s = skipNewModels(reader);
                if (!ok(s)) {
                    return s;
                }
            }

            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);

            Vec<i32> outTypes(*ctx.alloc);
            Vec<Vec<i32>> outModels(*ctx.alloc);
            auto rr = outTypes.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }

            for (std::size_t i = 0; i < count; i++) {
                i8 t = 0;
                s = reader.readByte(&t);
                if (!ok(s)) {
                    return s;
                }
                outTypes[i] = static_cast<i32>(t);

                u8 modelCountU8 = 0;
                s = reader.readUnsignedByte(&modelCountU8);
                if (!ok(s)) {
                    return s;
                }
                const std::size_t modelCount = static_cast<std::size_t>(modelCountU8);

                Vec<i32> modelIds(*ctx.alloc);
                rr = modelIds.resize(modelCount);
                if (!rr.isOk()) {
                    return rr.status();
                }

                for (std::size_t j = 0; j < modelCount; j++) {
                    i32 mid = 0;
                    s = readModelId(reader, &mid);
                    if (!ok(s)) {
                        return s;
                    }
                    modelIds[j] = mid;
                }

                rr = outModels.pushBack(rs::move(modelIds));
                if (!rr.isOk()) {
                    return rr.status();
                }
            }

            types = rs::move(outTypes);
            hasTypes = true;
            models = rs::move(outModels);

            if (opcode == 5 && !someBool) {
                return skipNewModels(reader);
            }

            return Status::Ok;
        }

        if (opcode == 1) {
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);
            if (count == 0) {
                return Status::Ok;
            }
            if (!models.empty() && !lowDetail) {
                // Skip count * (u16 + u8)
                return reader.skip(count * 3);
            }

            Vec<Vec<i32>> outModels(*ctx.alloc);
            Vec<i32> outTypes(*ctx.alloc);
            auto rr = outModels.reserve(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            rr = outTypes.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }

            for (std::size_t i = 0; i < count; i++) {
                u16 mid = 0;
                u8 t = 0;
                s = reader.readUnsignedShort(&mid);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readUnsignedByte(&t);
                if (!ok(s)) {
                    return s;
                }
                Vec<i32> group(*ctx.alloc);
                rr = group.resize(1);
                if (!rr.isOk()) {
                    return rr.status();
                }
                group[0] = static_cast<i32>(mid);
                rr = outModels.pushBack(rs::move(group));
                if (!rr.isOk()) {
                    return rr.status();
                }
                outTypes[i] = static_cast<i32>(t);
            }
            models = rs::move(outModels);
            types = rs::move(outTypes);
            hasTypes = true;
            return Status::Ok;
        }

        if (opcode == 2) {
            return readArenaString(reader, strTerm, *ctx.strings, &name);
        }
        if (opcode == 3) {
            hasDesc = true;
            return readArenaString(reader, strTerm, *ctx.strings, &desc);
        }

        if (opcode == 5) {
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);
            if (count == 0) {
                return Status::Ok;
            }
            if (!models.empty() && !lowDetail) {
                // Skip u16[count]
                return reader.skip(count * 2);
            }

            Vec<Vec<i32>> outModels(*ctx.alloc);
            Vec<i32> group(*ctx.alloc);
            auto rr = group.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            for (std::size_t i = 0; i < count; i++) {
                u16 mid = 0;
                s = reader.readUnsignedShort(&mid);
                if (!ok(s)) {
                    return s;
                }
                group[i] = static_cast<i32>(mid);
            }
            rr = outModels.pushBack(rs::move(group));
            if (!rr.isOk()) {
                return rr.status();
            }
            models = rs::move(outModels);
            hasTypes = false;
            types.clear();
            return Status::Ok;
        }

        if (opcode == 14 || opcode == 15) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            if (opcode == 14) {
                sizeX = static_cast<i32>(v);
            } else {
                sizeY = static_cast<i32>(v);
            }
            return Status::Ok;
        }

        if (opcode == 17) {
            clipType = 0;
            blocksProjectile = false;
            return Status::Ok;
        }
        if (opcode == 18) {
            blocksProjectile = false;
            return Status::Ok;
        }
        if (opcode == 19) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            isInteractive = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 21) {
            contouredGround = 0;
            contourGroundType = 1;
            return Status::Ok;
        }
        if (opcode == 22) {
            mergeNormals = true;
            return Status::Ok;
        }
        if (opcode == 23) {
            modelClipped = true;
            return Status::Ok;
        }
        if (opcode == 24) {
            i32 v = 0;
            Status s = readModelId(reader, &v);
            if (!ok(s)) {
                return s;
            }
            if (v == 65535) {
                v = -1;
            }
            seqId = v;
            return Status::Ok;
        }
        if (opcode == 27) {
            clipType = 1;
            return Status::Ok;
        }
        if (opcode == 28) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            decorDisplacement = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 29) {
            i8 v = 0;
            const Status s = reader.readByte(&v);
            if (!ok(s)) {
                return s;
            }
            ambient = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 39) {
            i8 v = 0;
            const Status s = reader.readByte(&v);
            if (!ok(s)) {
                return s;
            }
            contrast = static_cast<i32>(v) * 25;
            return Status::Ok;
        }
        if (opcode >= 30 && opcode < 39) {
            const int idx = static_cast<int>(opcode) - 30;
            Str sVal{};
            Status s = readArenaString(reader, strTerm, *ctx.strings, &sVal);
            if (!ok(s)) {
                return s;
            }
            if (equalsIgnoreCaseAscii(sVal, "hidden")) {
                hasAction[idx] = false;
                actions[idx] = Str{};
                return Status::Ok;
            }
            hasAction[idx] = true;
            actions[idx] = sVal;
            return Status::Ok;
        }
        if (opcode == 40 || opcode == 41) {
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);
            Vec<i32> from(*ctx.alloc);
            Vec<i32> to(*ctx.alloc);
            auto rr = from.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            rr = to.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            for (std::size_t i = 0; i < count; i++) {
                u16 a = 0;
                u16 b = 0;
                s = reader.readUnsignedShort(&a);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readUnsignedShort(&b);
                if (!ok(s)) {
                    return s;
                }
                from[i] = static_cast<i32>(a);
                to[i] = static_cast<i32>(b);
            }
            if (opcode == 40) {
                recolorFrom = rs::move(from);
                recolorTo = rs::move(to);
            } else {
                retextureFrom = rs::move(from);
                retextureTo = rs::move(to);
            }
            return Status::Ok;
        }
        if (opcode == 44 || opcode == 45) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 60) {
            u16 v = 0;
            Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            mapFunctionId = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 61) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 62) {
            isRotated = true;
            return Status::Ok;
        }
        if (opcode == 64) {
            clipped = false;
            return Status::Ok;
        }
        if (opcode == 65 || opcode == 66 || opcode == 67) {
            u16 v = 0;
            Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            if (opcode == 65) {
                modelSizeX = static_cast<i32>(v);
            } else if (opcode == 66) {
                modelSizeHeight = static_cast<i32>(v);
            } else {
                modelSizeY = static_cast<i32>(v);
            }
            return Status::Ok;
        }
        if (opcode == 68) {
            u16 v = 0;
            Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            mapSceneId = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 69) {
            u8 v = 0;
            return reader.readUnsignedByte(&v);
        }
        if (opcode == 70 || opcode == 71 || opcode == 72) {
            i16 v = 0;
            Status s = reader.readShort(&v);
            if (!ok(s)) {
                return s;
            }
            if (opcode == 70) {
                offsetX = static_cast<i32>(v);
            } else if (opcode == 71) {
                offsetHeight = static_cast<i32>(v);
            } else {
                offsetY = static_cast<i32>(v);
            }
            return Status::Ok;
        }
        if (opcode == 73) {
            obstructsGround = true;
            return Status::Ok;
        }
        if (opcode == 74) {
            isHollow = true;
            return Status::Ok;
        }
        if (opcode == 75) {
            u8 v = 0;
            Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            supportItems = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 77 || opcode == 92) {
            u16 vb = 0;
            u16 vp = 0;
            Status s = reader.readUnsignedShort(&vb);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&vp);
            if (!ok(s)) {
                return s;
            }
            transformVarbit = (vb == 0xFFFFu) ? -1 : static_cast<i32>(vb);
            transformVarp = (vp == 0xFFFFu) ? -1 : static_cast<i32>(vp);

            i32 var3 = -1;
            if (opcode == 92) {
                i32 v = 0;
                s = readModelId(reader, &v);
                if (!ok(s)) {
                    return s;
                }
                var3 = (v == 65535) ? -1 : v;
            }

            u8 countU8 = 0;
            s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);
            Vec<i32> out(*ctx.alloc);
            auto rr = out.resize(count + 2);
            if (!rr.isOk()) {
                return rr.status();
            }
            for (std::size_t i = 0; i <= count; i++) {
                i32 tid = 0;
                s = readModelId(reader, &tid);
                if (!ok(s)) {
                    return s;
                }
                if (tid == 65535) {
                    tid = -1;
                }
                out[i] = tid;
            }
            out[count + 1] = var3;
            transforms = rs::move(out);
            return Status::Ok;
        }
        if (opcode == 78) {
            u16 idU16 = 0;
            u8 distU8 = 0;
            Status s = reader.readUnsignedShort(&idU16);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedByte(&distU8);
            if (!ok(s)) {
                return s;
            }
            ambientSoundId = static_cast<i32>(idU16);
            ambientSoundDistance = static_cast<i32>(distU8);
            if (cacheInfo.game == GameType::Oldschool && cacheInfo.revision >= 220) {
                u8 retain = 0;
                s = reader.readUnsignedByte(&retain);
                if (!ok(s)) {
                    return s;
                }
                ambientSoundRetain = static_cast<i32>(retain);
            }
            return Status::Ok;
        }
        if (opcode == 79) {
            u16 minU16 = 0;
            u16 maxU16 = 0;
            u8 distU8 = 0;
            Status s = reader.readUnsignedShort(&minU16);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&maxU16);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedByte(&distU8);
            if (!ok(s)) {
                return s;
            }
            ambientSoundChangeTicksMin = static_cast<i32>(minU16);
            ambientSoundChangeTicksMax = static_cast<i32>(maxU16);
            ambientSoundDistance = static_cast<i32>(distU8);
            if (cacheInfo.game == GameType::Oldschool && cacheInfo.revision >= 220) {
                u8 retain = 0;
                s = reader.readUnsignedByte(&retain);
                if (!ok(s)) {
                    return s;
                }
                ambientSoundRetain = static_cast<i32>(retain);
            }
            u8 countU8 = 0;
            s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);
            Vec<i32> ids(*ctx.alloc);
            auto rr = ids.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            for (std::size_t i = 0; i < count; i++) {
                u16 v = 0;
                s = reader.readUnsignedShort(&v);
                if (!ok(s)) {
                    return s;
                }
                ids[i] = static_cast<i32>(v);
            }
            ambientSoundIds = rs::move(ids);
            return Status::Ok;
        }
        if (opcode == 81) {
            u8 v = 0;
            Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            contouredGround = static_cast<i32>(v) * 256;
            contourGroundType = 2;
            contourGroundParam = toSigned16bit(contouredGround);
            return Status::Ok;
        }
        if (opcode == 82) {
            if (cacheInfo.game == GameType::Oldschool) {
                u16 v = 0;
                Status s = reader.readUnsignedShort(&v);
                if (!ok(s)) {
                    return s;
                }
                mapFunctionId = static_cast<i32>(v);
            }
            return Status::Ok;
        }
        if (opcode == 88) {
            hardShadow = false;
            return Status::Ok;
        }
        if (opcode == 89) {
            seqRandomStart = false;
            return Status::Ok;
        }
        if (opcode == 90) {
            return Status::Ok;
        }
        if (opcode == 91) {
            membersOnly = true;
            return Status::Ok;
        }
        if (opcode == 93) {
            contourGroundType = 3;
            i16 v = 0;
            Status s = reader.readShort(&v);
            if (!ok(s)) {
                return s;
            }
            contourGroundParam = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 94) {
            contourGroundType = 4;
            return Status::Ok;
        }
        if (opcode == 95) {
            contourGroundType = 5;
            if (cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 614) {
                u16 v = 0;
                Status s = reader.readUnsignedShort(&v);
                if (!ok(s)) {
                    return s;
                }
                contourGroundParam = static_cast<i32>(v);
            }
            return Status::Ok;
        }
        if (opcode == 96) {
            return Status::Ok;
        }
        if (opcode == 97) {
            rotateMapSceneSprite = true;
            return Status::Ok;
        }
        if (opcode == 98) {
            animated = true;
            return Status::Ok;
        }
        if (opcode == 99 || opcode == 100) {
            u8 opU8 = 0;
            u16 idU16 = 0;
            Status s = reader.readUnsignedByte(&opU8);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&idU16);
            if (!ok(s)) {
                return s;
            }
            if (opcode == 99) {
                cursor1Op = static_cast<i32>(opU8);
                cursor1 = static_cast<i32>(idU16);
            } else {
                cursor2Op = static_cast<i32>(opU8);
                cursor2 = static_cast<i32>(idU16);
            }
            return Status::Ok;
        }
        if (opcode == 101) {
            u8 v = 0;
            Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            mapSceneRotationOffset = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 102) {
            u16 v = 0;
            Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            mapSceneId = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 103) {
            occludeRoofs = true;
            return Status::Ok;
        }
        if (opcode == 104) {
            u8 v = 0;
            Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            ambientSoundVolume = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 105) {
            flipMapSceneSprite = true;
            return Status::Ok;
        }
        if (opcode == 106) {
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);
            Vec<i32> ids(*ctx.alloc);
            Vec<i32> delays(*ctx.alloc);
            auto rr = ids.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            rr = delays.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            for (std::size_t i = 0; i < count; i++) {
                i32 sid = 0;
                s = readModelId(reader, &sid);
                if (!ok(s)) {
                    return s;
                }
                u8 delayU8 = 0;
                s = reader.readUnsignedByte(&delayU8);
                if (!ok(s)) {
                    return s;
                }
                ids[i] = sid;
                delays[i] = static_cast<i32>(delayU8);
            }
            randomSeqIds = rs::move(ids);
            randomSeqDelays = rs::move(delays);
            return Status::Ok;
        }
        if (opcode == 107) {
            u16 v = 0;
            Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            mapFunctionId = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode >= 150 && opcode < 155) {
            const int idx = static_cast<int>(opcode) - 150;
            Str sVal{};
            Status s = readArenaString(reader, strTerm, *ctx.strings, &sVal);
            if (!ok(s)) {
                return s;
            }
            if (equalsIgnoreCaseAscii(sVal, "hidden")) {
                hasAction[idx] = false;
                actions[idx] = Str{};
                return Status::Ok;
            }
            hasAction[idx] = true;
            actions[idx] = sVal;
            return Status::Ok;
        }
        if (opcode == 160) {
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);
            Vec<i32> out(*ctx.alloc);
            auto rr = out.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            for (std::size_t i = 0; i < count; i++) {
                u16 v = 0;
                s = reader.readUnsignedShort(&v);
                if (!ok(s)) {
                    return s;
                }
                out[i] = static_cast<i32>(v);
            }
            quests = rs::move(out);
            return Status::Ok;
        }
        if (opcode == 163) {
            i8 a = 0;
            i8 b = 0;
            i8 c = 0;
            i8 d = 0;
            Status s = reader.readByte(&a);
            if (!ok(s)) {
                return s;
            }
            s = reader.readByte(&b);
            if (!ok(s)) {
                return s;
            }
            s = reader.readByte(&c);
            if (!ok(s)) {
                return s;
            }
            s = reader.readByte(&d);
            if (!ok(s)) {
                return s;
            }
            targetHue = static_cast<i32>(a);
            targetSaturation = static_cast<i32>(b);
            targetLightness = static_cast<i32>(c);
            colourShiftPercentage = static_cast<i32>(d);
            return Status::Ok;
        }
        if (opcode == 167) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 168) {
            vorbisSound = true;
            return Status::Ok;
        }
        if (opcode == 169) {
            randomSound = true;
            return Status::Ok;
        }
        if (opcode == 170 || opcode == 171) {
            i32 v = 0;
            Status s = reader.readUnsignedSmart(&v);
            if (!ok(s)) {
                return s;
            }
            if (opcode == 170) {
                occlusionHeight = v;
            } else {
                occlusionOffset = v;
            }
            return Status::Ok;
        }
        if (opcode == 173) {
            u16 a = 0;
            u16 b = 0;
            Status s = reader.readUnsignedShort(&a);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&b);
            if (!ok(s)) {
                return s;
            }
            ambientSoundRateMin = static_cast<i32>(a);
            ambientSoundRateMax = static_cast<i32>(b);
            return Status::Ok;
        }
        if (opcode == 177) {
            forceDynamic = true;
            return Status::Ok;
        }
        if (opcode == 178) {
            u8 v = 0;
            Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            ambientSoundSize = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 249) {
            return readParamsMap(reader, *ctx.strings, *ctx.alloc, &params);
        }

        return Status::Unsupported;
    }

    void post() noexcept {
        if (isInteractive == -1) {
            isInteractive = 0;
            if (!models.empty() && (!hasTypes || (!types.empty() && types[0] == 10))) {
                isInteractive = 1;
            }
            for (int i = 0; i < 5; i++) {
                if (hasAction[i]) {
                    isInteractive = 1;
                }
            }
        }
        if (supportItems == -1) {
            supportItems = (clipType != 0) ? 1 : 0;
        }
    }
};

} // namespace rs

