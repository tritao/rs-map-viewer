#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Status.hpp"
#include "../../core/Str.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../ParamsMap.hpp"
#include "../TypeDecode.hpp"

namespace rs {

struct QuestVar {
    i32 id = 0;
    i32 inProgressValue = 0;
    i32 completedValue = 0;
};

struct QuestSkillReq {
    i32 id = 0;
    i32 level = 0;
};

struct QuestType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    bool hasName = false;
    Str name{};
    bool hasSortName = false;
    Str sortName{};

    Vec<QuestVar> varps{};
    Vec<QuestVar> varbits{};

    i32 type = 0;
    i32 difficulty = 0;
    bool member = false;
    i32 points = 0;

    Vec<i32> questRequirements{};
    Vec<QuestSkillReq> skillRequirements{};
    i32 pointsRequirement = 0;

    ParamsMap params{};

    QuestType() = default;
    QuestType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    static Status readVerString(Uint8ArrayReader& reader, StringArena& strings, Str* out, bool* present) noexcept {
        if (!out || !present) {
            return Status::InvalidArgument;
        }
        i8 lead = 0;
        Status s = reader.readByte(&lead);
        if (!ok(s)) {
            return s;
        }
        if (lead != 0) {
            *present = false;
            *out = Str{};
            return Status::Ok;
        }
        *present = true;
        return readArenaString(reader, 0, strings, out);
    }

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext& ctx) noexcept {
        if (!ctx.strings || !ctx.alloc) {
            return Status::InvalidArgument;
        }

        if (opcode == 1) {
            return readVerString(reader, *ctx.strings, &name, &hasName);
        }
        if (opcode == 2) {
            return readVerString(reader, *ctx.strings, &sortName, &hasSortName);
        }
        if (opcode == 3 || opcode == 4) {
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);
            Vec<QuestVar> out(*ctx.alloc);
            auto rr = out.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            for (std::size_t i = 0; i < count; i++) {
                u16 idU16 = 0;
                i32 inProg = 0;
                i32 completed = 0;
                s = reader.readUnsignedShort(&idU16);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readInt(&inProg);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readInt(&completed);
                if (!ok(s)) {
                    return s;
                }
                QuestVar v{};
                v.id = static_cast<i32>(idU16);
                v.inProgressValue = inProg;
                v.completedValue = completed;
                out[i] = v;
            }
            if (opcode == 3) {
                varps = rs::move(out);
            } else {
                varbits = rs::move(out);
            }
            return Status::Ok;
        }
        if (opcode == 5) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 6) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            type = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 7) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            difficulty = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 8) {
            member = true;
            return Status::Ok;
        }
        if (opcode == 9) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            points = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 10) {
            u8 count = 0;
            Status s = reader.readUnsignedByte(&count);
            if (!ok(s)) {
                return s;
            }
            for (u8 i = 0; i < count; i++) {
                i32 v = 0;
                s = reader.readInt(&v);
                if (!ok(s)) {
                    return s;
                }
            }
            return Status::Ok;
        }
        if (opcode == 12) {
            i32 v = 0;
            return reader.readInt(&v);
        }
        if (opcode == 13) {
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
            questRequirements = rs::move(out);
            return Status::Ok;
        }
        if (opcode == 14) {
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);
            Vec<QuestSkillReq> out(*ctx.alloc);
            auto rr = out.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            for (std::size_t i = 0; i < count; i++) {
                u8 idU8 = 0;
                u8 lvlU8 = 0;
                s = reader.readUnsignedByte(&idU8);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readUnsignedByte(&lvlU8);
                if (!ok(s)) {
                    return s;
                }
                QuestSkillReq r{};
                r.id = static_cast<i32>(idU8);
                r.level = static_cast<i32>(lvlU8);
                out[i] = r;
            }
            skillRequirements = rs::move(out);
            return Status::Ok;
        }
        if (opcode == 15) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            pointsRequirement = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 17) {
            if (cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 670) {
                i32 v = 0;
                return reader.readBigSmart(&v);
            }
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 18 || opcode == 19) {
            // Skip blocks; TS reads ints and strings.
            u8 count = 0;
            Status s = reader.readUnsignedByte(&count);
            if (!ok(s)) {
                return s;
            }
            for (u8 i = 0; i < count; i++) {
                i32 a = 0;
                i32 b = 0;
                i32 c = 0;
                s = reader.readInt(&a);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readInt(&b);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readInt(&c);
                if (!ok(s)) {
                    return s;
                }
                Str tmp{};
                s = readArenaString(reader, 0, *ctx.strings, &tmp);
                if (!ok(s)) {
                    return s;
                }
            }
            return Status::Ok;
        }
        if (opcode == 249) {
            return readParamsMap(reader, *ctx.strings, *ctx.alloc, &params);
        }

        return Status::Unsupported;
    }

    void post() noexcept {
        if (!hasSortName && hasName) {
            sortName = name;
            hasSortName = true;
        }
    }
};

} // namespace rs

