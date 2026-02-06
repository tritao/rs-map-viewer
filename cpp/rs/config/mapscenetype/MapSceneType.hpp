#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Status.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../TypeDecode.hpp"

namespace rs {

struct MapSceneType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    i32 spriteId = -1;
    i32 colorRgb = 0;
    bool enlarge = false;

    MapSceneType() = default;
    MapSceneType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext&) noexcept {
        if (opcode == 1) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            spriteId = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 2) {
            u32 v = 0;
            const Status s = reader.readMedium(&v);
            if (!ok(s)) {
                return s;
            }
            colorRgb = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 3) {
            enlarge = true;
            return Status::Ok;
        }
        if (opcode == 4) {
            spriteId = -1;
            return Status::Ok;
        }
        return Status::Unsupported;
    }
};

} // namespace rs

