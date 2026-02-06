#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../TypeDecode.hpp"

namespace rs {

struct SpotAnimType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    i32 modelId = -1;
    i32 sequenceId = -1;

    Vec<i32> recolorFrom{};
    Vec<i32> recolorTo{};

    Vec<i32> retextureFrom{};
    Vec<i32> retextureTo{};

    i32 widthScale = 128;
    i32 heightScale = 128;
    i32 orientation = 0;
    i32 ambient = 0;
    i32 contrast = 0;

    SpotAnimType() = default;
    SpotAnimType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext& ctx) noexcept {
        if (opcode == 1) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            modelId = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 2) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            sequenceId = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 4) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            widthScale = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 5) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            heightScale = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 6) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            orientation = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 7) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            ambient = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 8) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            contrast = static_cast<i32>(v);
            return Status::Ok;
        }
        if (opcode == 40) {
            if (!ctx.alloc) {
                return Status::InvalidArgument;
            }
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);
            Vec<i32> from(*ctx.alloc);
            Vec<i32> to(*ctx.alloc);
            auto rr = from.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            rr = to.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            for (std::size_t i = 0; i < count; i++) {
                u16 a = 0;
                u16 b = 0;
                s = reader.readUnsignedShort(&a);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readUnsignedShort(&b);
                if (!ok(s)) {
                    return s;
                }
                from[i] = static_cast<i32>(a);
                to[i] = static_cast<i32>(b);
            }
            recolorFrom = rs::move(from);
            recolorTo = rs::move(to);
            return Status::Ok;
        }
        if (opcode == 41) {
            if (!ctx.alloc) {
                return Status::InvalidArgument;
            }
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);
            Vec<i32> from(*ctx.alloc);
            Vec<i32> to(*ctx.alloc);
            auto rr = from.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            rr = to.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            for (std::size_t i = 0; i < count; i++) {
                u16 a = 0;
                u16 b = 0;
                s = reader.readUnsignedShort(&a);
                if (!ok(s)) {
                    return s;
                }
                s = reader.readUnsignedShort(&b);
                if (!ok(s)) {
                    return s;
                }
                from[i] = static_cast<i32>(a);
                to[i] = static_cast<i32>(b);
            }
            retextureFrom = rs::move(from);
            retextureTo = rs::move(to);
            return Status::Ok;
        }
        return Status::Unsupported;
    }
};

} // namespace rs

