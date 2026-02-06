#pragma once

#include <cstddef>

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheType.hpp"
#include "../core/Status.hpp"
#include "../core/StringArena.hpp"
#include "../core/Str.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../types.hpp"

namespace rs {

struct TypeDecodeError {
    i32 id = -1;
    u8 opcode = 0;
    std::size_t offset = 0;
    Status status = Status::Ok;
};

struct TypeDecodeContext {
    const CacheInfo& cacheInfo;
    StringArena* strings = nullptr;
};

inline u8 configStringTerminator(const CacheInfo& cacheInfo) noexcept {
    const CacheType cacheType = detectCacheType(cacheInfo);
    return (cacheType == CacheType::Dat2) ? 0 : 0x0A;
}

inline Status skipString(Uint8ArrayReader& reader, u8 terminator) noexcept {
    while (true) {
        u8 b = 0;
        const Status s = reader.readUnsignedByte(&b);
        if (!ok(s)) {
            return s;
        }
        if (b == terminator) {
            return Status::Ok;
        }
    }
}

inline Status readArenaString(Uint8ArrayReader& reader, u8 terminator, StringArena& strings, Str* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    Span<const u8> bytes;
    const Status s = reader.readBytesUntil(terminator, &bytes);
    if (!ok(s)) {
        return s;
    }
    auto r = strings.copyBytes(bytes);
    if (!r.isOk()) {
        return r.status();
    }
    *out = r.value();
    return Status::Ok;
}

template <typename T>
static auto decodeOpcodeImpl(T& out, u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext& ctx, int) noexcept
    -> decltype(out.decodeOpcode(opcode, reader, ctx)) {
    return out.decodeOpcode(opcode, reader, ctx);
}

template <typename T>
static Status decodeOpcodeImpl(T& out, u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext&, ...) noexcept {
    return out.decodeOpcode(opcode, reader);
}

// Convention: config "type" decoding is opcode-driven and terminates on opcode=0.
// The concrete type provides:
//   Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader) noexcept;
template <typename T>
Status decodeType(T& out, Uint8ArrayReader& reader, TypeDecodeError* err, const TypeDecodeContext* ctx) noexcept {
    while (true) {
        const std::size_t before = reader.tell();
        u8 opcode = 0;
        Status s = reader.readUnsignedByte(&opcode);
        if (!ok(s)) {
            if (err) {
                err->id = out.id;
                err->opcode = 0;
                err->offset = before;
                err->status = s;
            }
            return s;
        }
        if (opcode == 0) {
            return Status::Ok;
        }
        if (ctx) {
            s = decodeOpcodeImpl(out, opcode, reader, *ctx, 0);
        } else {
            // For types that only implement the context-aware signature, provide an empty/default context.
            // This is primarily for tests or ad-hoc decode calls.
            const TypeDecodeContext empty{out.cacheInfo, nullptr};
            s = decodeOpcodeImpl(out, opcode, reader, empty, 0);
        }
        if (!ok(s)) {
            if (err) {
                err->id = out.id;
                err->opcode = opcode;
                err->offset = reader.tell();
                err->status = s;
            }
            return s;
        }
    }
}

template <typename T>
Status decodeType(T& out, Uint8ArrayReader& reader, TypeDecodeError* err) noexcept {
    return decodeType(out, reader, err, nullptr);
}

} // namespace rs
