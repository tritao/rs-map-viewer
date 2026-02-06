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

struct NpcType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    Str name = strLiteral("null");

    i32 size = 1;

    Vec<i32> modelIds{};
    Vec<i32> chatheadModelIds{};
    i32 idleSeqId = -1;
    i32 turnLeftSeqId = -1;
    i32 turnRightSeqId = -1;

    i32 walkSeqId = -1;
    i32 walkBackSeqId = -1;
    i32 walkLeftSeqId = -1;
    i32 walkRightSeqId = -1;

    Vec<i32> recolorFrom{};
    Vec<i32> recolorTo{};

    Vec<i32> retextureFrom{};
    Vec<i32> retextureTo{};

    bool hasAction[5]{};
    Str actions[5]{};

    bool drawMapDot = true;
    i32 combatLevel = -1;

    i32 widthScale = 128;
    i32 heightScale = 128;

    bool isVisible = false;
    i32 ambient = 0;
    i32 contrast = 0;

    i32 headIconPrayer = -1;
    Vec<i32> headIconSpriteIds{};
    Vec<i32> headIconSpriteIndices{};

    i32 rotationSpeed = 32;

    Vec<i32> transforms{};
    i32 transformVarbit = -1;
    i32 transformVarp = -1;

    bool isInteractable = true;
    bool isClickable = true;
    bool isFollower = false;

    i32 runSeqId = -1;
    i32 runBackSeqId = -1;
    i32 runLeftSeqId = -1;
    i32 runRightSeqId = -1;

    i32 crawlSeqId = -1;
    i32 crawlBackSeqId = -1;
    i32 crawlLeftSeqId = -1;
    i32 crawlRightSeqId = -1;

    i32 category = -1;
    i32 loginScreenProps = 0;
    i32 spawnDirection = 6;

    i32 basTypeId = -1;

    i32 readySoundId = -1;
    i32 crawlSoundId = -1;
    i32 walkSoundId = -1;
    i32 runSoundId = -1;
    i32 soundRangeMin = 0;
    i32 soundRangeMax = 0;
    i32 soundVolume = 0;

    i32 cursor1Op = -1;
    i32 cursor1 = -1;
    i32 cursor2Op = -1;
    i32 cursor2 = -1;
    i32 attackCursor = -1;
    i32 mapElementId = -1;
    i32 mobilisingArmiesIcon = -1;
    i32 timerbarSpriteId = -1;
    i32 healthBarSpriteId = -1;

    bool lowPriority = false;
    i32 colourHue = 0;
    i32 colourSaturation = 0;
    i32 colourLightness = 0;
    i32 colourScale = 0;
    i32 followerOpsPriorityFlag = -1;
    Vec<i32> quests{};
    bool vorbisSound = false;
    i32 soundRateMin = 256;
    i32 soundRateMax = 256;
    i32 pickSizeShift = 0;

    ParamsMap params{};

    NpcType() = default;
    NpcType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

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

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext& ctx) noexcept {
        if (!ctx.strings || !ctx.alloc) {
            return Status::InvalidArgument;
        }

        const u8 strTerm = configStringTerminator(cacheInfo);

        if (opcode == 1) {
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
                i32 idv = 0;
                s = readModelId(reader, &idv);
                if (!ok(s)) {
                    return s;
                }
                out[i] = idv;
            }
            modelIds = rs::move(out);
            return Status::Ok;
        }

        if (opcode == 2) {
            return readArenaString(reader, strTerm, *ctx.strings, &name);
        }

        if (opcode == 3) {
            // desc (skip)
            Str tmp{};
            return readArenaString(reader, strTerm, *ctx.strings, &tmp);
        }

        if (opcode == 12) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            size = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode == 13 || opcode == 14 || opcode == 15) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            if (opcode == 13) {
                idleSeqId = static_cast<i32>(v);
            } else if (opcode == 14) {
                walkSeqId = static_cast<i32>(v);
            } else {
                turnLeftSeqId = static_cast<i32>(v);
            }
            return Status::Ok;
        }

        if (opcode == 16) {
            if (cacheInfo.game == GameType::Runescape && cacheInfo.revision < 254) {
                return Status::Ok;
            }
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            turnRightSeqId = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode == 17) {
            u16 a = 0;
            u16 b = 0;
            u16 c = 0;
            u16 d = 0;
            Status s = reader.readUnsignedShort(&a);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&b);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&c);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&d);
            if (!ok(s)) {
                return s;
            }
            walkSeqId = static_cast<i32>(a);
            walkBackSeqId = static_cast<i32>(b);
            walkLeftSeqId = static_cast<i32>(c);
            walkRightSeqId = static_cast<i32>(d);
            return Status::Ok;
        }

        if (opcode == 18) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            category = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode >= 30 && opcode < 35) {
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
                i32 idv = 0;
                s = readModelId(reader, &idv);
                if (!ok(s)) {
                    return s;
                }
                out[i] = idv;
            }
            chatheadModelIds = rs::move(out);
            return Status::Ok;
        }

        if (opcode == 93) {
            drawMapDot = false;
            return Status::Ok;
        }

        if (opcode == 95) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            combatLevel = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode == 97 || opcode == 98) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            if (opcode == 97) {
                widthScale = static_cast<i32>(v);
            } else {
                heightScale = static_cast<i32>(v);
            }
            return Status::Ok;
        }

        if (opcode == 99) {
            isVisible = true;
            return Status::Ok;
        }

        if (opcode == 100) {
            i8 v = 0;
            const Status s = reader.readByte(&v);
            if (!ok(s)) {
                return s;
            }
            ambient = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode == 101) {
            i8 v = 0;
            const Status s = reader.readByte(&v);
            if (!ok(s)) {
                return s;
            }
            contrast = static_cast<i32>(v) * 5;
            return Status::Ok;
        }

        if (opcode == 102) {
            if ((cacheInfo.game == GameType::Oldschool && cacheInfo.revision < 210) || cacheInfo.game == GameType::Runescape) {
                u16 v = 0;
                const Status s = reader.readUnsignedShort(&v);
                if (!ok(s)) {
                    return s;
                }
                headIconPrayer = static_cast<i32>(v);
                return Status::Ok;
            }

            u8 flag = 0;
            Status s = reader.readUnsignedByte(&flag);
            if (!ok(s)) {
                return s;
            }
            int count = 0;
            for (u8 n = flag; n != 0; n >>= 1) {
                count++;
            }

            Vec<i32> ids(*ctx.alloc);
            Vec<i32> indices(*ctx.alloc);
            auto rr = ids.resize(static_cast<std::size_t>(count));
            if (!rr.isOk()) {
                return rr.status();
            }
            rr = indices.resize(static_cast<std::size_t>(count));
            if (!rr.isOk()) {
                return rr.status();
            }
            for (int i = 0; i < count; i++) {
                ids[static_cast<std::size_t>(i)] = -1;
                indices[static_cast<std::size_t>(i)] = -1;
            }

            for (int i = 0; i < count; i++) {
                if ((flag & static_cast<u8>(1u << i)) == 0) {
                    ids[static_cast<std::size_t>(i)] = -1;
                    indices[static_cast<std::size_t>(i)] = -1;
                } else {
                    i32 iconId = 0;
                    s = reader.readBigSmart(&iconId);
                    if (!ok(s)) {
                        return s;
                    }
                    i32 idx = 0;
                    s = reader.readUnsignedSmartMin1(&idx);
                    if (!ok(s)) {
                        return s;
                    }
                    ids[static_cast<std::size_t>(i)] = iconId;
                    indices[static_cast<std::size_t>(i)] = idx;
                }
            }

            headIconSpriteIds = rs::move(ids);
            headIconSpriteIndices = rs::move(indices);
            return Status::Ok;
        }

        if (opcode == 103) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            rotationSpeed = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode == 106 || opcode == 118) {
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
            if (opcode == 118) {
                u16 v = 0;
                s = reader.readUnsignedShort(&v);
                if (!ok(s)) {
                    return s;
                }
                var3 = (v == 0xFFFFu) ? -1 : static_cast<i32>(v);
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
                u16 v = 0;
                s = reader.readUnsignedShort(&v);
                if (!ok(s)) {
                    return s;
                }
                out[i] = (v == 0xFFFFu) ? -1 : static_cast<i32>(v);
            }
            out[count + 1] = var3;
            transforms = rs::move(out);
            return Status::Ok;
        }

        if (opcode == 107) {
            isInteractable = false;
            return Status::Ok;
        }
        if (opcode == 109) {
            isClickable = false;
            return Status::Ok;
        }

        if (opcode == 111) {
            if (cacheInfo.game == GameType::Oldschool) {
                isFollower = true;
            }
            return Status::Ok;
        }
        if (opcode == 112) {
            return Status::Ok;
        }
        if (opcode == 113) {
            u16 a = 0;
            u16 b = 0;
            Status s = reader.readUnsignedShort(&a);
            if (!ok(s)) {
                return s;
            }
            return reader.readUnsignedShort(&b);
        }
        if (opcode == 114) {
            if (cacheInfo.game == GameType::Oldschool) {
                u16 v = 0;
                const Status s = reader.readUnsignedShort(&v);
                if (!ok(s)) {
                    return s;
                }
                runSeqId = static_cast<i32>(v);
                return Status::Ok;
            }
            i8 a = 0;
            i8 b = 0;
            Status s = reader.readByte(&a);
            if (!ok(s)) {
                return s;
            }
            return reader.readByte(&b);
        }
        if (opcode == 115) {
            if (cacheInfo.game == GameType::Oldschool) {
                u16 a = 0;
                u16 b = 0;
                u16 c = 0;
                u16 d = 0;
                Status s = reader.readUnsignedShort(&a);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readUnsignedShort(&b);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readUnsignedShort(&c);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readUnsignedShort(&d);
                if (!ok(s)) {
                    return s;
                }
                runSeqId = static_cast<i32>(a);
                runBackSeqId = static_cast<i32>(b);
                runLeftSeqId = static_cast<i32>(c);
                runRightSeqId = static_cast<i32>(d);
                return Status::Ok;
            }
            u8 a = 0;
            u8 b = 0;
            Status s = reader.readUnsignedByte(&a);
            if (!ok(s)) {
                return s;
            }
            return reader.readUnsignedByte(&b);
        }
        if (opcode == 116) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            crawlSeqId = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 117) {
            u16 a = 0;
            u16 b = 0;
            u16 c = 0;
            u16 d = 0;
            Status s = reader.readUnsignedShort(&a);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&b);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&c);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&d);
            if (!ok(s)) {
                return s;
            }
            crawlSeqId = static_cast<i32>(a);
            crawlBackSeqId = static_cast<i32>(b);
            crawlLeftSeqId = static_cast<i32>(c);
            crawlRightSeqId = static_cast<i32>(d);
            return Status::Ok;
        }
        if (opcode == 119) {
            i8 v = 0;
            const Status s = reader.readByte(&v);
            if (!ok(s)) {
                return s;
            }
            loginScreenProps = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 121) {
            // model offsets (skip)
            u8 count = 0;
            Status s = reader.readUnsignedByte(&count);
            if (!ok(s)) {
                return s;
            }
            for (u8 i = 0; i < count; i++) {
                u8 index = 0;
                i8 x = 0;
                i8 y = 0;
                i8 z = 0;
                s = reader.readUnsignedByte(&index);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readByte(&x);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readByte(&y);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readByte(&z);
                if (!ok(s)) {
                    return s;
                }
            }
            return Status::Ok;
        }
        if (opcode == 122) {
            if (cacheInfo.game == GameType::Oldschool) {
                isFollower = true;
                return Status::Ok;
            }
            if (isLargeModelId()) {
                i32 v = 0;
                return reader.readBigSmart(&v);
            }
            u16 v = 0;
            Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            healthBarSpriteId = (v == 0xFFFFu) ? -1 : static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 123) {
            if (cacheInfo.game == GameType::Oldschool) {
                return Status::Ok;
            }
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 125) {
            i8 v = 0;
            const Status s = reader.readByte(&v);
            if (!ok(s)) {
                return s;
            }
            spawnDirection = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 127) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            basTypeId = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 128) {
            u8 v = 0;
            return reader.readUnsignedByte(&v);
        }
        if (opcode == 134) {
            u16 a = 0;
            u16 b = 0;
            u16 c = 0;
            u16 d = 0;
            u8 max = 0;
            Status s = reader.readUnsignedShort(&a);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&b);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&c);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&d);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedByte(&max);
            if (!ok(s)) {
                return s;
            }
            readySoundId = (a == 0xFFFFu) ? -1 : static_cast<i32>(a);
            crawlSoundId = (b == 0xFFFFu) ? -1 : static_cast<i32>(b);
            walkSoundId = (c == 0xFFFFu) ? -1 : static_cast<i32>(c);
            runSoundId = (d == 0xFFFFu) ? -1 : static_cast<i32>(d);
            soundRangeMax = static_cast<i32>(max);
            return Status::Ok;
        }
        if (opcode == 135 || opcode == 136) {
            u8 op = 0;
            u16 v = 0;
            Status s = reader.readUnsignedByte(&op);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            if (opcode == 135) {
                cursor1Op = static_cast<i32>(op);
                cursor1 = static_cast<i32>(v);
            } else {
                cursor2Op = static_cast<i32>(op);
                cursor2 = static_cast<i32>(v);
            }
            return Status::Ok;
        }
        if (opcode == 137) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            attackCursor = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 138) {
            if (isLargeModelId()) {
                return reader.readBigSmart(&mobilisingArmiesIcon);
            }
            u16 v = 0;
            Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            mobilisingArmiesIcon = (v == 0xFFFFu) ? -1 : static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 139) {
            if (isLargeModelId()) {
                return reader.readBigSmart(&timerbarSpriteId);
            }
            u16 v = 0;
            Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            timerbarSpriteId = (v == 0xFFFFu) ? -1 : static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 140) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            soundVolume = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 141) {
            isFollower = true;
            return Status::Ok;
        }
        if (opcode == 142) {
            u16 v = 0;
            Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            mapElementId = (v == 0xFFFFu) ? -1 : static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 143) {
            lowPriority = true;
            return Status::Ok;
        }
        if (opcode == 144) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
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
        if (opcode == 155) {
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
            colourHue = static_cast<i32>(a);
            colourSaturation = static_cast<i32>(b);
            colourLightness = static_cast<i32>(c);
            colourScale = static_cast<i32>(d);
            return Status::Ok;
        }
        if (opcode == 158) {
            followerOpsPriorityFlag = 1;
            return Status::Ok;
        }
        if (opcode == 159) {
            followerOpsPriorityFlag = 0;
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
        if (opcode == 161) {
            return Status::Ok;
        }
        if (opcode == 162) {
            vorbisSound = true;
            return Status::Ok;
        }
        if (opcode == 163) {
            u8 v = 0;
            return reader.readUnsignedByte(&v);
        }
        if (opcode == 164) {
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
            soundRateMin = static_cast<i32>(a);
            soundRateMax = static_cast<i32>(b);
            return Status::Ok;
        }
        if (opcode == 165) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            pickSizeShift = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 168) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            soundRangeMin = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode >= 170 && opcode < 176) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 249) {
            return readParamsMap(reader, *ctx.strings, *ctx.alloc, &params);
        }

        return Status::Unsupported;
    }
};

} // namespace rs

