#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Status.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../TypeDecode.hpp"

namespace rs {

struct InvType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    i32 itemCount = 0;

    InvType() = default;
    InvType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext&) noexcept {
        if (opcode != 2) {
            return Status::Unsupported;
        }
        u16 v = 0;
        const Status s = reader.readUnsignedShort(&v);
        if (!ok(s)) {
            return s;
        }
        itemCount = static_cast<i32>(v);
        return Status::Ok;
    }
};

} // namespace rs

