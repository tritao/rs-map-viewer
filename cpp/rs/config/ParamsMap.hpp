#pragma once

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../core/Str.hpp"
#include "../core/StringArena.hpp"
#include "../core/Vec.hpp"
#include "../io/Uint8ArrayReader.hpp"
#include "../types.hpp"

namespace rs {

struct ParamValue {
    bool isString = false;
    i32 intValue = 0;
    Str stringValue{};
};

struct ParamsMap {
    Vec<i32> keys{};
    Vec<ParamValue> values{};
};

inline Status readParamsMap(Uint8ArrayReader& reader, StringArena& strings, Allocator& alloc, ParamsMap* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    u8 countU8 = 0;
    Status s = reader.readUnsignedByte(&countU8);
    if (!ok(s)) {
        return s;
    }
    const std::size_t count = static_cast<std::size_t>(countU8);

    Vec<i32> keys(alloc);
    Vec<ParamValue> values(alloc);
    auto rr = keys.resize(count);
    if (!rr.isOk()) {
        return rr.status();
    }
    rr = values.resize(count);
    if (!rr.isOk()) {
        return rr.status();
    }

    for (std::size_t i = 0; i < count; i++) {
        u8 isString = 0;
        s = reader.readUnsignedByte(&isString);
        if (!ok(s)) {
            return s;
        }
        u32 key = 0;
        s = reader.readMedium(&key);
        if (!ok(s)) {
            return s;
        }
        keys[i] = static_cast<i32>(key);

        ParamValue v{};
        if (isString == 1) {
            Span<const u8> bytes;
            s = reader.readBytesUntil(0, &bytes);
            if (!ok(s)) {
                return s;
            }
            auto r = strings.copyBytes(bytes);
            if (!r.isOk()) {
                return r.status();
            }
            v.isString = true;
            v.stringValue = r.value();
        } else {
            i32 iv = 0;
            s = reader.readInt(&iv);
            if (!ok(s)) {
                return s;
            }
            v.isString = false;
            v.intValue = iv;
        }
        values[i] = v;
    }

    out->keys = rs::move(keys);
    out->values = rs::move(values);
    return Status::Ok;
}

} // namespace rs

