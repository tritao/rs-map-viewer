#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Status.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../ParamsMap.hpp"
#include "../TypeDecode.hpp"

namespace rs {

struct StructType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    ParamsMap params{};

    StructType() = default;
    StructType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext& ctx) noexcept {
        if (opcode != 249) {
            return Status::Unsupported;
        }
        if (!ctx.strings || !ctx.alloc) {
            return Status::InvalidArgument;
        }
        return readParamsMap(reader, *ctx.strings, *ctx.alloc, &params);
    }
};

} // namespace rs

