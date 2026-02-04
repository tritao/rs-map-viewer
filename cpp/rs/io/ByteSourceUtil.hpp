#pragma once

#include <vector>

#include "ByteSource.hpp"

namespace rs {

inline std::vector<u8> readAllBytes(const ByteSource& source) {
    std::vector<u8> out;
    out.resize(source.size());
    if (!out.empty()) {
        source.readInto(0, out.data(), out.size());
    }
    return out;
}

} // namespace rs

