#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <vector>

namespace rs_core {

inline uint16_t read_u16_be(const uint8_t* p) {
    return static_cast<uint16_t>((static_cast<uint16_t>(p[0]) << 8) | static_cast<uint16_t>(p[1]));
}

inline uint32_t read_u24_be(const uint8_t* p) {
    return (static_cast<uint32_t>(p[0]) << 16) | (static_cast<uint32_t>(p[1]) << 8) |
           static_cast<uint32_t>(p[2]);
}

inline uint32_t read_u32_be(const uint8_t* p) {
    return (static_cast<uint32_t>(p[0]) << 24) | (static_cast<uint32_t>(p[1]) << 16) |
           (static_cast<uint32_t>(p[2]) << 8) | static_cast<uint32_t>(p[3]);
}

inline int32_t read_i32_be(const uint8_t* p) {
    return static_cast<int32_t>(read_u32_be(p));
}

inline void write_i32_be(uint8_t* p, int32_t v) {
    const uint32_t u = static_cast<uint32_t>(v);
    p[0] = static_cast<uint8_t>((u >> 24) & 0xff);
    p[1] = static_cast<uint8_t>((u >> 16) & 0xff);
    p[2] = static_cast<uint8_t>((u >> 8) & 0xff);
    p[3] = static_cast<uint8_t>(u & 0xff);
}

struct ByteSource {
    std::vector<uint8_t> data;

    explicit ByteSource(std::vector<uint8_t> bytes) : data(std::move(bytes)) {}

    std::size_t size() const { return data.size(); }

    void read_into(std::size_t offset, uint8_t* out, std::size_t len) const {
        if (offset > data.size() || len > data.size() - offset) {
            throw std::out_of_range("read_into out of bounds");
        }
        std::memcpy(out, data.data() + offset, len);
    }
};

} // namespace rs_core
