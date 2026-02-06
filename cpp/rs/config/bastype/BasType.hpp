#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Status.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../TypeDecode.hpp"

namespace rs {

struct BasType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    i32 idleSeqId = -1;
    i32 walkSeqId = -1;

    bool hasModelRotateTranslate[12]{};
    i16 modelRotateTranslate[12][6]{};

    BasType() = default;
    BasType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext&) noexcept {
        if (opcode == 1) {
            u16 idle = 0;
            u16 walk = 0;
            Status s = reader.readUnsignedShort(&idle);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&walk);
            if (!ok(s)) {
                return s;
            }
            idleSeqId = (idle == 0xFFFFu) ? -1 : static_cast<i32>(idle);
            walkSeqId = (walk == 0xFFFFu) ? -1 : static_cast<i32>(walk);
            return Status::Ok;
        }

        // opcodes 2..9: various crawl/run sequences (skip for now; TS does too)
        if (opcode >= 2 && opcode <= 9) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }

        if (opcode == 26) {
            u8 a = 0;
            u8 b = 0;
            Status s = reader.readUnsignedByte(&a);
            if (!ok(s)) {
                return s;
            }
            return reader.readUnsignedByte(&b);
        }

        if (opcode == 27) {
            u8 bodyPartId = 0;
            Status s = reader.readUnsignedByte(&bodyPartId);
            if (!ok(s)) {
                return s;
            }
            if (bodyPartId >= 12) {
                return Status::OutOfRange;
            }
            for (int i = 0; i < 6; i++) {
                i16 v = 0;
                s = reader.readShort(&v);
                if (!ok(s)) {
                    return s;
                }
                modelRotateTranslate[bodyPartId][i] = v;
            }
            hasModelRotateTranslate[bodyPartId] = true;
            return Status::Ok;
        }

        // yaw/roll/pitch/movement etc: skip by consuming fields
        if (opcode == 29) {
            u8 v = 0;
            return reader.readUnsignedByte(&v);
        }
        if (opcode == 30) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 31) {
            u8 v = 0;
            return reader.readUnsignedByte(&v);
        }
        if (opcode == 32) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 33) {
            i16 v = 0;
            return reader.readShort(&v);
        }
        if (opcode == 34) {
            u8 v = 0;
            return reader.readUnsignedByte(&v);
        }
        if (opcode == 35) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode == 36) {
            i16 v = 0;
            return reader.readShort(&v);
        }
        if (opcode == 37) {
            u8 v = 0;
            return reader.readUnsignedByte(&v);
        }

        // 38..45 and 46..51: more seq/sprite/height fields (u16)
        if (opcode >= 38 && opcode <= 45) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }
        if (opcode >= 46 && opcode <= 51) {
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }

        // 52: weighted ready animations list (skip)
        if (opcode == 52) {
            u8 count = 0;
            Status s = reader.readUnsignedByte(&count);
            if (!ok(s)) {
                return s;
            }
            for (u8 i = 0; i < count; i++) {
                u16 id = 0;
                u8 weight = 0;
                s = reader.readUnsignedShort(&id);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readUnsignedByte(&weight);
                if (!ok(s)) {
                    return s;
                }
            }
            return Status::Ok;
        }

        if (opcode == 53) {
            return Status::Ok;
        }

        if (opcode == 54) {
            u8 a = 0;
            u8 b = 0;
            Status s = reader.readUnsignedByte(&a);
            if (!ok(s)) {
                return s;
            }
            return reader.readUnsignedByte(&b);
        }

        if (opcode == 55) {
            u8 slot = 0;
            Status s = reader.readUnsignedByte(&slot);
            if (!ok(s)) {
                return s;
            }
            u16 v = 0;
            return reader.readUnsignedShort(&v);
        }

        // 56: graphic offsets (g2s x3) in 2011/667; TS file had a typo duplicating 54.
        if (opcode == 56) {
            u8 slot = 0;
            Status s = reader.readUnsignedByte(&slot);
            if (!ok(s)) {
                return s;
            }
            for (int i = 0; i < 3; i++) {
                i16 v = 0;
                s = reader.readShort(&v);
                if (!ok(s)) {
                    return s;
                }
            }
            return Status::Ok;
        }

        return Status::Unsupported;
    }
};

} // namespace rs

