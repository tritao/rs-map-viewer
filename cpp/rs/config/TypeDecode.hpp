#pragma once

#include <cstddef>

#include "../cache/CacheInfo.hpp"
#include "../core/Status.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../types.hpp"

namespace rs {

struct TypeDecodeError {
    i32 id = -1;
    u8 opcode = 0;
    std::size_t offset = 0;
    Status status = Status::Ok;
};

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

// Convention: config "type" decoding is opcode-driven and terminates on opcode=0.
// The concrete type provides:
//   Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader) noexcept;
template <typename T>
Status decodeType(T& out, Uint8ArrayReader& reader, TypeDecodeError* err) noexcept {
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
        s = out.decodeOpcode(opcode, reader);
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

} // namespace rs
