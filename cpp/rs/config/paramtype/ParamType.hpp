#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Status.hpp"
#include "../../core/Str.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../TypeDecode.hpp"

namespace rs {

struct ParamType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    // ScriptVarType as a raw byte (e.g. 's' for string).
    u8 type = 0;

    i32 defaultInt = 0;
    Str defaultString{};
    bool autoDisable = true;

    ParamType() = default;
    ParamType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    [[nodiscard]] bool isString() const noexcept { return type == static_cast<u8>('s'); }

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext& ctx) noexcept {
        if (opcode == 1) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            if (v == 0) {
                return Status::BadFormat;
            }
            type = v;
            return Status::Ok;
        }
        if (opcode == 2) {
            i32 v = 0;
            const Status s = reader.readInt(&v);
            if (!ok(s)) {
                return s;
            }
            defaultInt = v;
            return Status::Ok;
        }
        if (opcode == 4) {
            autoDisable = false;
            return Status::Ok;
        }
        if (opcode == 5) {
            if (!ctx.strings) {
                return Status::InvalidArgument;
            }
            const u8 term = configStringTerminator(cacheInfo);
            return readArenaString(reader, term, *ctx.strings, &defaultString);
        }
        return Status::Unsupported;
    }
};

} // namespace rs

