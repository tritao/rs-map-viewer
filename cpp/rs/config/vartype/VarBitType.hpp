#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Status.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"

namespace rs {

struct VarBitType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    // TS leaves this field unset for "empty" entries (bytes=[0]), and our parity harness hashes unset numeric
    // fields as 0 (via `x|0`). Default to 0 to match that behavior.
    i32 baseVar = 0;
    i32 startBit = 0;
    i32 endBit = 0;

    VarBitType() = default;
    VarBitType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader) noexcept {
        if (opcode != 1) {
            return Status::Unsupported;
        }
        u16 base = 0;
        u8 start = 0;
        u8 end = 0;
        Status s = reader.readUnsignedShort(&base);
        if (!ok(s)) {
            return s;
        }
        s = reader.readUnsignedByte(&start);
        if (!ok(s)) {
            return s;
        }
        s = reader.readUnsignedByte(&end);
        if (!ok(s)) {
            return s;
        }
        baseVar = static_cast<i32>(base);
        startBit = static_cast<i32>(start);
        endBit = static_cast<i32>(end);
        return Status::Ok;
    }
};

} // namespace rs
