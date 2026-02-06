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

struct MapElementType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    i32 spriteId = -1;
    i32 hoverSpriteId = -1;

    bool hasName = false;
    Str name{};

    i32 textColor = 0;
    i32 hoverTextColor = 0;

    i32 textSize = 0;

    bool worldMapVisible = true;
    bool minimapVisible = false;

    bool randomizePosition = true;
    bool showInElementList = true;

    bool hasOp[5]{};
    Str ops[5]{};

    ParamsMap params{};

    MapElementType() = default;
    MapElementType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext& ctx) noexcept {
        if (!ctx.strings || !ctx.alloc) {
            return Status::InvalidArgument;
        }

        if (opcode == 1) {
            i32 v = 0;
            const Status s = reader.readBigSmart(&v);
            if (!ok(s)) {
                return s;
            }
            spriteId = v;
            return Status::Ok;
        }
        if (opcode == 2) {
            i32 v = 0;
            const Status s = reader.readBigSmart(&v);
            if (!ok(s)) {
                return s;
            }
            hoverSpriteId = v;
            return Status::Ok;
        }
        if (opcode == 3) {
            const Status s = readArenaString(reader, 0, *ctx.strings, &name);
            if (!ok(s)) {
                return s;
            }
            hasName = true;
            return Status::Ok;
        }
        if (opcode == 4) {
            u32 v = 0;
            const Status s = reader.readMedium(&v);
            if (!ok(s)) {
                return s;
            }
            textColor = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 5) {
            u32 v = 0;
            const Status s = reader.readMedium(&v);
            if (!ok(s)) {
                return s;
            }
            hoverTextColor = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 6) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            textSize = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 7) {
            u8 flags = 0;
            const Status s = reader.readUnsignedByte(&flags);
            if (!ok(s)) {
                return s;
            }
            if ((flags & 0x1) == 0) {
                worldMapVisible = false;
            }
            if ((flags & 0x2) == 2) {
                minimapVisible = true;
            }
            return Status::Ok;
        }
        if (opcode == 8) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            randomizePosition = (v == 1);
            return Status::Ok;
        }
        if (opcode == 9) {
            u16 a = 0;
            u16 b = 0;
            i32 c = 0;
            i32 d = 0;
            Status s = reader.readUnsignedShort(&a);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&b);
            if (!ok(s)) {
                return s;
            }
            s = reader.readInt(&c);
            if (!ok(s)) {
                return s;
            }
            return reader.readInt(&d);
        }
        if (opcode >= 10 && opcode <= 14) {
            const int idx = static_cast<int>(opcode) - 10;
            const Status s = readArenaString(reader, 0, *ctx.strings, &ops[idx]);
            if (!ok(s)) {
                return s;
            }
            hasOp[idx] = true;
            return Status::Ok;
        }
        if (opcode == 15) {
            // Complex, revision-dependent; TS skips all payload.
            u8 count = 0;
            Status s = reader.readUnsignedByte(&count);
            if (!ok(s)) {
                return s;
            }
            // count*2 shorts
            for (u32 i = 0; i < static_cast<u32>(count) * 2u; i++) {
                i16 v = 0;
                s = reader.readShort(&v);
                if (!ok(s)) {
                    return s;
                }
            }
            i32 unused = 0;
            s = reader.readInt(&unused);
            if (!ok(s)) {
                return s;
            }

            // Oldschool/629+: extra block
            if (cacheInfo.game == GameType::Oldschool || (cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 629)) {
                u8 count2 = 0;
                s = reader.readUnsignedByte(&count2);
                if (!ok(s)) {
                    return s;
                }
                for (u8 i = 0; i < count2; i++) {
                    i32 v = 0;
                    s = reader.readInt(&v);
                    if (!ok(s)) {
                        return s;
                    }
                }
                for (u8 i = 0; i < count; i++) {
                    i8 v = 0;
                    s = reader.readByte(&v);
                    if (!ok(s)) {
                        return s;
                    }
                }
            } else {
                // older: one extra int
                s = reader.readInt(&unused);
                if (!ok(s)) {
                    return s;
                }
            }
            return Status::Ok;
        }
        if (opcode == 16) {
            showInElementList = false;
            return Status::Ok;
        }
        if (opcode == 17) {
            // opBase string
            Str tmp{};
            return readArenaString(reader, 0, *ctx.strings, &tmp);
        }
        if (opcode == 18) {
            i32 v = 0;
            return reader.readBigSmart(&v);
        }
        if (opcode == 19) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 20) {
            u16 a = 0;
            u16 b = 0;
            i32 c = 0;
            i32 d = 0;
            Status s = reader.readUnsignedShort(&a);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&b);
            if (!ok(s)) {
                return s;
            }
            s = reader.readInt(&c);
            if (!ok(s)) {
                return s;
            }
            return reader.readInt(&d);
        }
        if (opcode == 21 || opcode == 22) {
            i32 v = 0;
            return reader.readInt(&v);
        }
        if (opcode == 23) {
            u8 a = 0;
            u8 b = 0;
            u8 c = 0;
            Status s = reader.readUnsignedByte(&a);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedByte(&b);
            if (!ok(s)) {
                return s;
            }
            return reader.readUnsignedByte(&c);
        }
        if (opcode == 24) {
            i16 a = 0;
            i16 b = 0;
            Status s = reader.readShort(&a);
            if (!ok(s)) {
                return s;
            }
            return reader.readShort(&b);
        }
        if (opcode == 25) {
            i32 v = 0;
            return reader.readBigSmart(&v);
        }
        if (opcode == 28) {
            u8 v = 0;
            return reader.readUnsignedByte(&v);
        }
        if (opcode == 29 || opcode == 30) {
            u8 v = 0;
            return reader.readUnsignedByte(&v);
        }
        if (opcode == 249) {
            return readParamsMap(reader, *ctx.strings, *ctx.alloc, &params);
        }

        return Status::Unsupported;
    }
};

} // namespace rs

