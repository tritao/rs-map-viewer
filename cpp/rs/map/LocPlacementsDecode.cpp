#include "LocPlacementsDecode.hpp"

#include "../io/Uint8ArrayReader.hpp"

namespace rs {

Status decodeLocPlacementsFromBytes(Span<const u8> data, Vec<LocPlacement>* out, Allocator& alloc) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    *out = Vec<LocPlacement>(alloc);

    Uint8ArrayReader reader(data, 0);

    i32 id = -1;
    for (;;) {
        i32 idDelta = 0;
        Status s = reader.readSmart3(&idDelta);
        if (!ok(s)) {
            return s;
        }
        if (idDelta == 0) {
            break;
        }
        id += idDelta;

        i32 pos = 0;
        for (;;) {
            i32 posDelta = 0;
            s = reader.readUnsignedSmart(&posDelta);
            if (!ok(s)) {
                return s;
            }
            if (posDelta == 0) {
                break;
            }
            pos += (posDelta - 1);

            const i32 localX = (pos >> 6) & 0x3f;
            const i32 localY = pos & 0x3f;
            const i32 level = pos >> 12;

            u8 attributes = 0;
            s = reader.readUnsignedByte(&attributes);
            if (!ok(s)) {
                return s;
            }
            const i32 type = static_cast<i32>(attributes >> 2);
            const i32 rotation = static_cast<i32>(attributes & 0x3);

            LocPlacement p{};
            p.id = id;
            p.level = level;
            p.localX = localX;
            p.localY = localY;
            p.type = type;
            p.rotation = rotation;

            auto rr = out->pushBack(p);
            if (!rr.isOk()) {
                return rr.status();
            }
        }
    }

    return Status::Ok;
}

} // namespace rs

