#pragma once

#include "../../../cache/CacheInfo.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"

namespace rs {

struct VarPlayerType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    i32 type = 0;

    VarPlayerType() = default;
    VarPlayerType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader) noexcept {
        // Mirrors TS: only opcode 5 sets the type; unknown opcodes are ignored.
        if (opcode == 5) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            type = static_cast<i32>(v);
        }
        return Status::Ok;
    }
};

} // namespace rs

