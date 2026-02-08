#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Status.hpp"
#include "../../core/Str.hpp"
#include "../../core/StrUtil.hpp"
#include "../../core/Vec.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../TypeDecode.hpp"

namespace rs {

struct EnumType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    u8 inputType = 0;
    u8 outputType = 0;

    Str defaultString = strLiteral("null");
    i32 defaultInt = 0;

    i32 outputCount = 0;

    Vec<i32> keys{};
    Vec<i32> intValues{};
    Vec<Str> stringValues{};

    EnumType() = default;
    EnumType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext& ctx) noexcept {
        if (opcode == 1) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            inputType = v;
            return Status::Ok;
        }
        if (opcode == 2) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            outputType = v;
            return Status::Ok;
        }
        if (opcode == 3) {
            if (!ctx.strings) {
                return Status::InvalidArgument;
            }
            const u8 term = configStringTerminator(cacheInfo);
            return readArenaString(reader, term, *ctx.strings, &defaultString);
        }
        if (opcode == 4) {
            i32 v = 0;
            const Status s = reader.readInt(&v);
            if (!ok(s)) {
                return s;
            }
            defaultInt = v;
            return Status::Ok;
        }
        if (opcode == 5) {
            if (!ctx.alloc || !ctx.strings) {
                return Status::InvalidArgument;
            }
            u16 countU16 = 0;
            Status s = reader.readUnsignedShort(&countU16);
            if (!ok(s)) {
                return s;
            }
            outputCount = static_cast<i32>(countU16);
            const std::size_t count = static_cast<std::size_t>(countU16);

            Vec<i32> outKeys(*ctx.alloc);
            Vec<Str> outValues(*ctx.alloc);
            auto rr = outKeys.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            rr = outValues.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }

            const u8 term = configStringTerminator(cacheInfo);
            for (std::size_t i = 0; i < count; i++) {
                i32 k = 0;
                s = reader.readInt(&k);
                if (!ok(s)) {
                    return s;
                }
                outKeys[i] = k;

                Str sv{};
                s = readArenaString(reader, term, *ctx.strings, &sv);
                if (!ok(s)) {
                    return s;
                }
                outValues[i] = sv;
            }

            keys = rs::move(outKeys);
            stringValues = rs::move(outValues);
            intValues.clear();
            return Status::Ok;
        }
        if (opcode == 6) {
            if (!ctx.alloc) {
                return Status::InvalidArgument;
            }
            u16 countU16 = 0;
            Status s = reader.readUnsignedShort(&countU16);
            if (!ok(s)) {
                return s;
            }
            outputCount = static_cast<i32>(countU16);
            const std::size_t count = static_cast<std::size_t>(countU16);

            Vec<i32> outKeys(*ctx.alloc);
            Vec<i32> outValues(*ctx.alloc);
            auto rr = outKeys.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            rr = outValues.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }

            for (std::size_t i = 0; i < count; i++) {
                i32 k = 0;
                i32 v = 0;
                s = reader.readInt(&k);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readInt(&v);
                if (!ok(s)) {
                    return s;
                }
                outKeys[i] = k;
                outValues[i] = v;
            }

            keys = rs::move(outKeys);
            intValues = rs::move(outValues);
            stringValues.clear();
            return Status::Ok;
        }

        return Status::Unsupported;
    }
};

} // namespace rs
