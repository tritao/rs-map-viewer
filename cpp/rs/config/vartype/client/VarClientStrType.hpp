#pragma once

#include "../../../cache/CacheInfo.hpp"
#include "../../../core/Status.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"

namespace rs {

struct VarClientStrType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    bool persist = false;

    VarClientStrType() = default;
    VarClientStrType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    Status decodeOpcode(u8 opcode, Uint8ArrayReader&) noexcept {
        // Mirrors TS: only opcode 2 toggles persist; unknown opcodes are ignored.
        if (opcode == 2) {
            persist = true;
        }
        return Status::Ok;
    }
};

} // namespace rs

