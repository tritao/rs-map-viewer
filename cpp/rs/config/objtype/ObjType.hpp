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
#include "ObjStackability.hpp"

namespace rs {

struct ObjType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    i32 model = 0;
    Str name = strLiteral("null");

    Vec<i32> recolorFrom{};
    Vec<i32> recolorTo{};
    Vec<i32> retextureFrom{};
    Vec<i32> retextureTo{};

    i32 zoom2d = 2000;
    i32 xan2d = 0;
    i32 yan2d = 0;
    i32 zan2d = 0;
    i32 offsetX2d = 0;
    i32 offsetY2d = 0;

    Str op9{};

    ObjStackability stackability = ObjStackability::Sometimes;
    i32 price = 1;
    i32 op13 = -1;
    i32 op14 = -1;
    bool isMembers = false;

    bool hasGroundAction[5]{};
    Str groundActions[5]{};
    bool hasInventoryAction[5]{};
    Str inventoryActions[5]{};
    i32 shiftClickIndex = -2;

    i32 maleModel = -1;
    i32 maleModel1 = -1;
    i32 maleOffset = 0;
    i32 femaleModel = -1;
    i32 femaleModel1 = -1;
    i32 femaleOffset = 0;
    i32 maleModel2 = -1;
    i32 femaleModel2 = -1;

    i32 maleHeadModel = -1;
    i32 maleHeadModel2 = -1;
    i32 femaleHeadModel = -1;
    i32 femaleHeadModel2 = -1;

    Vec<i32> countObj{};
    Vec<i32> countCo{};

    i32 op27 = -1;
    i32 note = -1;
    i32 noteTemplate = -1;

    i32 resizeX = 128;
    i32 resizeY = 128;
    i32 resizeZ = 128;

    i32 ambient = 0;
    i32 contrast = 0;

    i32 team = 0;
    bool isTradable = false;
    i32 op75 = 0;

    i32 unnotedId = -1;
    i32 notedId = -1;

    i32 placeholder = -1;
    i32 placeholderTemplate = -1;

    ParamsMap params{};

    ObjType() = default;
    ObjType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {
        // Match TS defaults for a couple actions.
        groundActions[2] = strLiteral("Take");
        hasGroundAction[2] = true;
        inventoryActions[4] = strLiteral("Drop");
        hasInventoryAction[4] = true;
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

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext& ctx) noexcept {
        if (!ctx.strings || !ctx.alloc) {
            return Status::InvalidArgument;
        }

        const u8 strTerm = configStringTerminator(cacheInfo);

        if (opcode == 1) {
            return readModelId(reader, &model);
        }
        if (opcode == 2) {
            return readArenaString(reader, strTerm, *ctx.strings, &name);
        }
        if (opcode == 3) {
            // desc
            Str tmp{};
            return readArenaString(reader, strTerm, *ctx.strings, &tmp);
        }
        if (opcode == 4) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            zoom2d = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 5) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            xan2d = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 6) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            yan2d = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 7) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            offsetX2d = static_cast<i32>(v);
            if (offsetX2d > 32767) {
                offsetX2d -= 65536;
            }
            return Status::Ok;
        }
        if (opcode == 8) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            offsetY2d = static_cast<i32>(v);
            if (offsetY2d > 32767) {
                offsetY2d -= 65536;
            }
            return Status::Ok;
        }
        if (opcode == 9) {
            return readArenaString(reader, strTerm, *ctx.strings, &op9);
        }
        if (opcode == 10) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 11) {
            stackability = ObjStackability::Always;
            return Status::Ok;
        }
        if (opcode == 12) {
            i32 v = 0;
            const Status s = reader.readInt(&v);
            if (!ok(s)) {
                return s;
            }
            price = v;
            return Status::Ok;
        }
        if (opcode == 13) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            op13 = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 14) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            op14 = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 16) {
            isMembers = true;
            return Status::Ok;
        }
        if (opcode == 23) {
            Status s = readModelId(reader, &maleModel);
            if (!ok(s)) {
                return s;
            }
            if (cacheInfo.revision < 503) {
                u8 v = 0;
                s = reader.readUnsignedByte(&v);
                if (!ok(s)) {
                    return s;
                }
                maleOffset = static_cast<i32>(v);
            }
            return Status::Ok;
        }
        if (opcode == 24) {
            return readModelId(reader, &maleModel1);
        }
        if (opcode == 25) {
            Status s = readModelId(reader, &femaleModel);
            if (!ok(s)) {
                return s;
            }
            if (cacheInfo.revision < 503) {
                u8 v = 0;
                s = reader.readUnsignedByte(&v);
                if (!ok(s)) {
                    return s;
                }
                femaleOffset = static_cast<i32>(v);
            }
            return Status::Ok;
        }
        if (opcode == 26) {
            return readModelId(reader, &femaleModel1);
        }
        if (opcode == 27) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            op27 = static_cast<i32>(v);
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
                hasGroundAction[idx] = false;
                groundActions[idx] = Str{};
                return Status::Ok;
            }
            hasGroundAction[idx] = true;
            groundActions[idx] = sVal;
            return Status::Ok;
        }
        if (opcode >= 35 && opcode < 40) {
            const int idx = static_cast<int>(opcode) - 35;
            Str sVal{};
            const Status s = readArenaString(reader, strTerm, *ctx.strings, &sVal);
            if (!ok(s)) {
                return s;
            }
            hasInventoryAction[idx] = true;
            inventoryActions[idx] = sVal;
            return Status::Ok;
        }
        if (opcode == 40) {
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
            recolorFrom = rs::move(from);
            recolorTo = rs::move(to);
            return Status::Ok;
        }
        if (opcode == 41) {
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
            retextureFrom = rs::move(from);
            retextureTo = rs::move(to);
            return Status::Ok;
        }
        if (opcode == 42) {
            i8 v = 0;
            const Status s = reader.readByte(&v);
            if (!ok(s)) {
                return s;
            }
            shiftClickIndex = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 44 || opcode == 45) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 65) {
            isTradable = true;
            return Status::Ok;
        }
        if (opcode == 75) {
            i16 v = 0;
            const Status s = reader.readShort(&v);
            if (!ok(s)) {
                return s;
            }
            op75 = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 78) {
            return readModelId(reader, &maleModel2);
        }
        if (opcode == 79) {
            return readModelId(reader, &femaleModel2);
        }
        if (opcode == 90) {
            return readModelId(reader, &maleHeadModel);
        }
        if (opcode == 91) {
            return readModelId(reader, &femaleHeadModel);
        }
        if (opcode == 92) {
            return readModelId(reader, &maleHeadModel2);
        }
        if (opcode == 93) {
            return readModelId(reader, &femaleHeadModel2);
        }
        if (opcode == 94) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 95) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            zan2d = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 96) {
            u8 v = 0;
            return reader.readUnsignedByte(&v);
        }
        if (opcode == 97) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            note = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 98) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            noteTemplate = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode >= 100 && opcode < 110) {
            if (countObj.size() == 0) {
                Vec<i32> obj(*ctx.alloc);
                Vec<i32> co(*ctx.alloc);
                auto rr = obj.resize(10);
                if (!rr.isOk()) {
                    return rr.status();
                }
                rr = co.resize(10);
                if (!rr.isOk()) {
                    return rr.status();
                }
                for (std::size_t i = 0; i < 10; i++) {
                    obj[i] = 0;
                    co[i] = 0;
                }
                countObj = rs::move(obj);
                countCo = rs::move(co);
            }

            const std::size_t idx = static_cast<std::size_t>(opcode - 100);
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
            countObj[idx] = static_cast<i32>(a);
            countCo[idx] = static_cast<i32>(b);
            return Status::Ok;
        }
        if (opcode == 110 || opcode == 111 || opcode == 112) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            if (opcode == 110) {
                resizeX = static_cast<i32>(v);
            } else if (opcode == 111) {
                resizeY = static_cast<i32>(v);
            } else {
                resizeZ = static_cast<i32>(v);
            }
            return Status::Ok;
        }
        if (opcode == 113) {
            i8 v = 0;
            const Status s = reader.readByte(&v);
            if (!ok(s)) {
                return s;
            }
            ambient = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 114) {
            i8 v = 0;
            const Status s = reader.readByte(&v);
            if (!ok(s)) {
                return s;
            }
            contrast = static_cast<i32>(v) * 5;
            return Status::Ok;
        }
        if (opcode == 115) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            team = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 121 || opcode == 122) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 125 || opcode == 126) {
            i8 a = 0;
            i8 b = 0;
            i8 c = 0;
            Status s = reader.readByte(&a);
            if (!ok(s)) {
                return s;
            }
            s = reader.readByte(&b);
            if (!ok(s)) {
                return s;
            }
            return reader.readByte(&c);
        }
        if (opcode == 127 || opcode == 128 || opcode == 129 || opcode == 130) {
            u8 a = 0;
            u16 b = 0;
            Status s = reader.readUnsignedByte(&a);
            if (!ok(s)) {
                return s;
            }
            return reader.readUnsignedShort(&b);
        }
        if (opcode == 132) {
            u8 count = 0;
            Status s = reader.readUnsignedByte(&count);
            if (!ok(s)) {
                return s;
            }
            for (u8 i = 0; i < count; i++) {
                u16 v = 0;
                s = reader.readUnsignedShort(&v);
                if (!ok(s)) {
                    return s;
                }
            }
            return Status::Ok;
        }
        if (opcode == 139 || opcode == 140) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            if (opcode == 139) {
                unnotedId = static_cast<i32>(v);
            } else {
                notedId = static_cast<i32>(v);
            }
            return Status::Ok;
        }
        if (opcode >= 142 && opcode < 147) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 148 || opcode == 149) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            if (opcode == 148) {
                placeholder = static_cast<i32>(v);
            } else {
                placeholderTemplate = static_cast<i32>(v);
            }
            return Status::Ok;
        }
        if (opcode >= 150 && opcode < 155) {
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

